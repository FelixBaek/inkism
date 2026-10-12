import assert from "node:assert/strict";
import { chromium } from "playwright-core";
const base = process.env.INKISM_URL!;
const rpc = async (op: string, args: Record<string, unknown> = {}) => { const r = await fetch(base + "/api/rpc", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op, ...args }) }); const v = await r.json(); assert.equal(v.ok, true, JSON.stringify(v)); return v.data; };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
page.on("pageerror", error => console.log("PAGEERROR", error.message));
await page.addInitScript(() => { localStorage.setItem("inkism.lang", "ko"); localStorage.setItem("inkism.inspector", "false"); });
const note = await rpc("save", { note: { title: "Canvas attachment fixture", content: "<p>canvas source</p>", content_format: "html" } });
await rpc("workspace_set", { ids: [note.id], active: note.id, locations: {} });
try {
  await page.goto(base); await page.locator(".tiptap").waitFor();
  await page.getByRole("button", { name: "캔버스", exact: true }).click(); await page.waitForTimeout(500); console.log("buttons", await page.getByRole("button").allTextContents());
  const dialog = page.getByRole("dialog", { name: "라이브러리 도구", exact: true });
  const file = dialog.locator('input[type="file"]').first();
  await file.setInputFiles({ name: "pixel.png", mimeType: "image/png", buffer: Buffer.from("\x89PNG\r\n\x1a\n", "binary") });
  // The fixture is intentionally not a complete PNG; storage should still return a UUID,
  // while the safe preview endpoint can reject malformed image bytes.
  await page.waitForTimeout(1000); console.log("canvas-dialog", await dialog.innerText()); await dialog.locator(".canvas-card").first().waitFor(); console.log("canvas-card", await dialog.locator(".canvas-card").allTextContents());
  const card = dialog.locator(".canvas-card").first(); assert.equal(await card.locator("a").count(), 1);
  await dialog.getByRole("button", { name: "작업공간 저장", exact: true }).click(); await dialog.getByText("저장됨", { exact: true }).waitFor();
  const saved = await rpc("workspace_tools_get"); const asset = saved.canvas.value.nodes.find((n: { kind: string }) => n.kind === "file"); assert.match(asset.attachmentId, /^[0-9a-f-]{36}$/); assert.equal(asset.offline, false);
  await dialog.getByRole("button", { name: "닫기", exact: true }).click(); await page.reload(); await page.locator(".tiptap").waitFor(); await page.getByRole("button", { name: "캔버스", exact: true }).click(); const reopened = page.getByRole("dialog", { name: "라이브러리 도구", exact: true }); await reopened.locator(".canvas-card").first().waitFor(); assert.equal(await reopened.locator(".canvas-card").count(), 1);
  // Undo and redo are real state transitions, not only visual buttons.
  await reopened.getByRole("button", { name: "텍스트 카드", exact: true }).click(); assert.equal(await reopened.locator(".canvas-card").count(), 2); await reopened.getByRole("button", { name: "실행 취소", exact: true }).click(); assert.equal(await reopened.locator(".canvas-card").count(), 1); await reopened.getByRole("button", { name: "다시 실행", exact: true }).click(); assert.equal(await reopened.locator(".canvas-card").count(), 2);
  // Unknown fields require explicit confirmation and a dismissal must preserve the canvas.
  await page.once("dialog", d => { assert.equal(d.type(), "confirm"); void d.dismiss(); });
  const unknown = Buffer.from(JSON.stringify({ nodes: [{ id: "new", type: "text", text: "must not replace", x: 0, y: 0, width: 220, height: 130, futureField: true }], edges: [], futureRoot: true }));
  await reopened.locator('input[type="file"]').last().setInputFiles({ name: "unknown.canvas", mimeType: "application/json", buffer: unknown }); await page.waitForTimeout(200); assert.equal(await reopened.locator(".canvas-card").count(), 2);
  // Export follows JSON Canvas node/edge names and can be imported after confirmation.
  const [download] = await Promise.all([page.waitForEvent("download"), reopened.getByRole("button", { name: "내보내기", exact: true }).click()]); const stream = await download.createReadStream(); const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(Buffer.from(chunk)); const exported = JSON.parse(Buffer.concat(chunks).toString("utf8")); assert.ok(Array.isArray(exported.nodes)); assert.equal(exported.nodes.length, 2);
  assert.deepEqual((await rpc("workspace_tools_get")).canvas.value.nodes.length, 1, "canvas was not saved by a browser-only edit");
  console.log("PASS canvas upload/attachment preview link, persisted reopen, undo/redo, guarded import, JSON Canvas export");
} finally { await browser.close(); }
