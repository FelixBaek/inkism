import {resourceFonts} from "./font-resources";
import { readPref, writePref } from "./pref";
import { t } from "../i18n";

/** 선언형 편집기 패키지. 임의의 JavaScript는 의도적으로 지원하지 않는다. */
export interface PluginFont { id: string; label: string; family: string; url?: string; format?: "woff2" | "woff" | "ttf" | "otf" }
export interface PluginColor { id: string; label: string; value: string; kind?: "color" | "highlight" }
export interface EditorPlugin {
  id: string;
  version: string;
  name: string;
  description?: string;
  author?: string;
  origin: "builtin" | "user";
  enabled: boolean;
  fonts: PluginFont[];
  colors: PluginColor[];
}

const KEY = "inkism.plugins.v1";
export const PLUGIN_EVENT = "inkism-plugins";
const ID = /^[a-z][a-z0-9._-]{1,63}$/;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const FAMILY = /^[\p{L}\p{N} _.,'()\-]{1,100}$/u;
const COLOR = /^#[0-9a-f]{6}$/i;
const RESOURCE = /^(?:\/fonts\/[A-Za-z0-9_-]+\.(?:woff2?|ttf|otf)|\/api\/attachments\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
export const PLUGIN_PACKAGE_LIMIT = 256 * 1024;
const BUILTIN: EditorPlugin = {
  id: "inkism.bundled-editor",
  version: "1.0.0",
  name: "Inkism 기본 편집 리소스",
  description: "IBM Plex Sans KR Regular · SIL OFL 1.1",
  author: "Inkism",
  origin: "builtin",
  enabled: true,
  fonts: [
    { id: "ibm-plex-sans-kr", label: "IBM Plex Sans KR", family: "Inkism Package Plex KR", url: "/fonts/IBMPlexSansKR-Regular.woff2", format: "woff2" },
  ],
  colors: [],
};

function validResource(url: unknown): url is string { return typeof url === "string" && RESOURCE.test(url); }
function validFont(item: unknown): item is PluginFont {
  if (!item || typeof item !== "object") return false;
  const x = item as Record<string, unknown>;
  return typeof x.id === "string" && ID.test(x.id) && typeof x.label === "string" && x.label.trim().length > 0 && x.label.length <= 80 &&
    typeof x.family === "string" && FAMILY.test(x.family.trim()) && (x.url === undefined || (validResource(x.url) && (x.format === undefined || ["woff2", "woff", "ttf", "otf"].includes(x.format as string))));
}
function validColor(item: unknown): item is PluginColor {
  if (!item || typeof item !== "object") return false;
  const x = item as Record<string, unknown>;
  return typeof x.id === "string" && ID.test(x.id) && typeof x.label === "string" && x.label.trim().length > 0 && x.label.length <= 80 &&
    typeof x.value === "string" && COLOR.test(x.value) && (x.kind === undefined || x.kind === "color" || x.kind === "highlight");
}

/** 외부 JSON은 host가 origin을 부여하며, manifest의 실행 코드/미지원 기능은 거부한다. */
export function validatePlugin(input: unknown): Omit<EditorPlugin, "origin" | "enabled"> {
  if (!input || typeof input !== "object") throw new Error(t("플러그인 파일 형식이 아닙니다."));
  const x = input as Record<string, unknown>;
  if (typeof x.id !== "string" || !ID.test(x.id) || x.id === BUILTIN.id) throw new Error(t("플러그인 ID가 올바르지 않습니다."));
  if (typeof x.version !== "string" || !VERSION.test(x.version)) throw new Error(t("플러그인 버전은 1.2.3 형식이어야 합니다."));
  if (typeof x.name !== "string" || x.name.trim().length === 0 || x.name.length > 100) throw new Error(t("플러그인 이름이 올바르지 않습니다."));
  if (x.entry !== undefined || x.main !== undefined || x.script !== undefined || x.capabilities !== undefined) throw new Error(t("실행 코드나 지원하지 않는 기능이 포함되어 있습니다."));
  const fonts = x.fonts === undefined ? [] : x.fonts;
  const colors = x.colors === undefined ? [] : x.colors;
  if (!Array.isArray(fonts) || fonts.length > 100 || !fonts.every(validFont)) throw new Error(t("폰트 리소스가 올바르지 않습니다."));
  if (!Array.isArray(colors) || colors.length > 100 || !colors.every(validColor)) throw new Error(t("색상 리소스가 올바르지 않습니다."));
  if (new Set((fonts as PluginFont[]).map((f) => f.id)).size !== (fonts as PluginFont[]).length || new Set((colors as PluginColor[]).map((c) => c.id)).size !== (colors as PluginColor[]).length) throw new Error(t("리소스 ID가 중복됩니다."));
  return { id: x.id, version: x.version, name: x.name.trim(), description: typeof x.description === "string" ? x.description.slice(0, 300) : undefined, author: typeof x.author === "string" ? x.author.slice(0, 100) : undefined, fonts: fonts as PluginFont[], colors: colors as PluginColor[] };
}

function stored(): EditorPlugin[] {
  try {
    const value: unknown = JSON.parse(readPref(KEY) || "[]");
    if (!Array.isArray(value)) return [];
    return value.slice(0, 101).flatMap((x): EditorPlugin[] => {
      if (!x || typeof x !== "object") return [];
      const raw = x as Record<string, unknown>;
      if (raw.origin === "user") { try { const p = validatePlugin(raw); return [{ ...p, origin: "user", enabled: raw.enabled === true }]; } catch { return []; } }
      if (raw.origin === "builtin" && raw.id === BUILTIN.id) return [{ ...BUILTIN, enabled: raw.enabled !== false }];
      return [];
    }).filter((p, i, all) => all.findIndex((x) => x.id === p.id) === i);
  } catch { return []; }
}
function users(): EditorPlugin[] { return stored().filter((p) => p.origin === "user"); }
export function getPlugins(): EditorPlugin[] { return [stored().find((p) => p.id === BUILTIN.id) ?? BUILTIN, ...users()]; }
export function importPlugin(input: unknown): EditorPlugin {
  const next = { ...validatePlugin(input), origin: "user" as const, enabled: true };
  const existing = users();
  if (existing.length >= 100 && !existing.some((p) => p.id === next.id)) throw new Error(t("플러그인은 100개까지 등록할 수 있습니다."));
  writePref(KEY, JSON.stringify([getPlugins()[0], ...existing.filter((p) => p.id !== next.id), next]));
  emit();
  return next;
}
export function setPluginEnabled(id: string, enabled: boolean) {
  if (id === BUILTIN.id) writePref(KEY, JSON.stringify([{ ...BUILTIN, enabled }, ...users()]));
  else writePref(KEY, JSON.stringify([getPlugins()[0], ...users().map((p) => p.id === id ? { ...p, enabled } : p)]));
  emit();
}
export function removePlugin(id: string) {
  if (id === BUILTIN.id) return;
  writePref(KEY, JSON.stringify([getPlugins()[0], ...users().filter((p) => p.id !== id)]));
  emit();
}
function emit() { window.dispatchEvent(new Event(PLUGIN_EVENT)); }
export function activePluginFonts(): PluginFont[] { return [...resourceFonts(),...getPlugins().filter((p) => p.enabled).flatMap((p) => p.fonts)]; }
export function activePluginColors(): PluginColor[] { return getPlugins().filter((p) => p.enabled).flatMap((p) => p.colors); }
export function installPluginFontStyles() {
  if (typeof document === "undefined") return;
  const id = "inkism-plugin-fonts";
  document.getElementById(id)?.remove();
  const style = document.createElement("style"); style.id = id;
  style.textContent = activePluginFonts().filter((f) => f.url).map((f) => { const format = f.format === "ttf" ? "truetype" : f.format === "otf" ? "opentype" : f.format ?? (f.url?.endsWith(".woff") ? "woff" : f.url?.endsWith(".ttf") ? "truetype" : f.url?.endsWith(".otf") ? "opentype" : "woff2"); return `@font-face{font-family:"${f.family.replace(/"/g, "")}";src:url("${f.url}") format("${format}");font-display:swap}`; }).join("\n");
  document.head.appendChild(style);
}
export function subscribePlugins(onChange: () => void) { window.addEventListener(PLUGIN_EVENT, onChange); return () => window.removeEventListener(PLUGIN_EVENT, onChange); }
