import {ExecutablePluginSettings} from "./ExecutablePluginSettings";
import { useEffect, useRef, useState } from "react";
import { getPlugins, importPlugin, PLUGIN_PACKAGE_LIMIT, removePlugin, setPluginEnabled, subscribePlugins, type EditorPlugin } from "../lib/plugins";
import { t } from "../i18n";

export function PluginSettings() {
  const [plugins, setPlugins] = useState<EditorPlugin[]>(getPlugins);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => subscribePlugins(() => setPlugins(getPlugins())), []);
  const load = async (file: File) => { try { if (file.size > PLUGIN_PACKAGE_LIMIT) throw new Error(t("플러그인 파일은 256KB 이하만 가져올 수 있습니다.")); importPlugin(JSON.parse(await file.text())); setError(null); } catch (e) { setError(e instanceof Error ? e.message : t("플러그인을 가져오지 못했습니다.")); } };
  return <>
    <ExecutablePluginSettings />
    <div className="settings-card plugin-import-card"><div className="settings-card__text"><strong>{t("플러그인 가져오기")}</strong><p>{t("폰트와 색상만 제공하는 JSON 패키지를 등록합니다. 실행 코드와 외부 주소는 허용하지 않습니다.")}</p></div><div className="settings-card__action"><button type="button" className="btn" onClick={() => input.current?.click()}>{t("JSON 가져오기")}</button><input ref={input} hidden type="file" accept="application/json,.json" onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = ""; }} /></div></div>
    {error && <p role="alert" className="plugin-error">{error}</p>}
    <div className="plugin-list" aria-label={t("설치된 플러그인")}>{plugins.map((p) => <article className="settings-card plugin-card" key={p.id}><div className="settings-card__text"><strong>{p.name} <span className="plugin-version">v{p.version}</span></strong><p>{p.description || p.id}</p><small>{p.origin === "builtin" ? t("기본 제공") : t("사용자 설치")} · {p.fonts.length} {t("개 글꼴")} · {p.colors.length} {t("개 색상")}</small></div><div className="settings-card__action"><label className="plugin-toggle"><input type="checkbox" checked={p.enabled} onChange={(e) => setPluginEnabled(p.id, e.target.checked)} /> {p.enabled ? t("사용") : t("사용 안 함")}</label>{p.origin === "user" && <button type="button" className="btn btn-small" onClick={() => removePlugin(p.id)}>{t("삭제")}</button>}</div></article>)}</div>
  </>;
}
