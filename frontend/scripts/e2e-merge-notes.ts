import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const base = process.env.INKISM_URL || "http://127.0.0.1:49323";
const rpc = async (op: string, args: Record<string, unknown> = {}) => {
  const response = await fetch(`${base}/api/rpc`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op, ...args }) });
  const envelope = await response.json();
  assert.equal(envelope.ok, true, JSON.stringify(envelope));
  return envelope.data;
};
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
try {
  await page.addInitScript(() => { localStorage.setItem("inkism.lang", "ko"); localStorage.setItem("inkism.inspector", "false"); });
  const stamp = Date.now();
  const source = await rpc("save", { note: { title: `Merge source ${stamp}`, content: "source body", content_format: "text" } });
  const target = await rpc("save", { note: { title: `Merge target ${stamp}`, content: "target body", content_format: "text" } });
  await rpc("workspace_set", { ids: [source.id, target.id], active: source.id, locations: {} });
  await page.goto(base); await page.locator(".writing-tools").waitFor();
  await page.getByRole("button", { name: "노트 합치기", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "노트 합치기", exact: true }); await dialog.waitFor();
  await dialog.locator("label").filter({ hasText: "원본 노트" }).locator("select").selectOption(source.id);
  await dialog.locator("label").filter({ hasText: "대상 노트" }).locator("select").selectOption(target.id);
  await dialog.getByRole("button", { name: "합치고 원본을 휴지통으로 이동", exact: true }).click();
  for (let i = 0; i < 100; i++) { const note = await rpc("get", { id: target.id }); if (note.content.includes("source body")) break; await page.waitForTimeout(80); }
  if (!(await rpc("get", { id: target.id })).content.includes("source body")) throw new Error(`merge UI did not commit: ${await dialog.textContent()}`);
  const merged = await rpc("get", { id: target.id }); const trashed = await rpc("get", { id: source.id });
  assert.match(merged.content, /target body/); assert.match(merged.content, /source body/); assert.equal(trashed.trashed, true);
  const resolved = await rpc("link_resolve", { target: `note://${source.id}` }); assert.equal(resolved.items[0].id, target.id);
  await rpc("patch", { id: source.id, revision: trashed.revision, changes: { trashed: false } });
  const restored = await rpc("link_resolve", { target: `note://${source.id}` }); assert.equal(restored.items[0].id, source.id);
  console.log("PASS merge UI: dialog selection, atomic target/source result, redirect resolution, restore precedence");
} finally { await browser.close(); }
