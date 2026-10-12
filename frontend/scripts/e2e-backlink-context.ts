import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
let active = 0, maxActive = 0, requestNo = 0;
const firstTarget = "target-a", secondTarget = "target-b";
const waits = new Map<string, () => void>();
const notes = new Map([
  ["source-1", { id: "source-1", title: "One", content: '<p><a href="note://target-a">old target A</a></p>', text: "old target A", content_format: "html", trashed: false, locked: false }],
  ["source-2", { id: "source-2", title: "Two", content: '<p><a href="note://target-b">new target B</a></p>', text: "new target B", content_format: "html", trashed: false, locked: false }],
]);

const server = await createServer({ root, server: { host: "127.0.0.1", port: 0, strictPort: false }, plugins: [{
  name: "backlink-context-harness",
  configureServer(vite) {
    vite.middlewares.use("/__backlink-context", async (_req, res) => {
      const html = await vite.transformIndexHtml("/__backlink-context", `<div id="root"></div><script type="module">
        import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
        import {BacklinkList} from '/src/components/NoteInspector.tsx';
        const entries={a:{id:'target-a'},b:{id:'target-b'}};
        window.setTarget=(key)=>window.dispatchEvent(new CustomEvent('target',{detail:key}));
        function App(){const [key,setKey]=useState('a'); React.useEffect(()=>{const f=e=>setKey(e.detail);window.addEventListener('target',f);return()=>window.removeEventListener('target',f)},[]);
          const target=entries[key]; const links=key==='a'?[{id:'source-1',title:'One',preview:'old preview'}]:[{id:'source-1',title:'One',preview:'old preview'},{id:'source-2',title:'Two',preview:'new preview'}];
          return React.createElement(BacklinkList,{s:{note:target,backlinks:links,selectNote(){}}});}
        createRoot(document.getElementById('root')).render(React.createElement(App));
      </script>`); res.setHeader("Content-Type", "text/html"); res.end(html);
    });
  },
}, {
  name: "backlink-api-fixture",
  configureServer(vite) {
    vite.middlewares.use("/api/rpc", async (req, res, next) => {
      if (req.method !== "POST") return next();
      let body = ""; for await (const chunk of req) body += chunk;
      const request = JSON.parse(body);
      if (request.op === "knowledge_get") { res.setHeader("Content-Type","application/json");res.end(JSON.stringify({ok:true,data:{aliases:[]}}));return; }
      if (request.op !== "get") return next();
      const note = notes.get(request.id); if (!note) { res.statusCode = 404; res.end(JSON.stringify({ ok: false, error: "missing" })); return; }
      requestNo++; active++; maxActive = Math.max(maxActive, active);
      const done = () => { active--; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ ok: true, data: note })); };
      const failed = () => { active--; res.statusCode = 503; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ ok: false, error: "fixture failure" })); };
      if (requestNo === 1) await new Promise<void>(resolve => waits.set("first", () => { waits.delete("first"); resolve(); }));
      else await new Promise(resolve => setTimeout(resolve, 40));
      if (request.id === "source-1" && requestNo > 1) failed(); else done();
    });
  },
}]});
await server.listen();
const port = (server.httpServer!.address() as { port: number }).port;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] });
const page = await browser.newPage();
try {
  await page.goto(`http://127.0.0.1:${port}/__backlink-context`);
  await page.getByText("old preview").waitFor();
  for(let i=0;i<100&&!waits.has("first");i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.ok(waits.has("first"),"delayed read must be running before switch");
  await page.evaluate(() => window.setTarget("b"));
  waits.get("first")?.();
  await page.getByText("new target B").waitFor();
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(await page.getByText("old target A").count(), 0, "stale target-A context must not survive target switch");
  assert.ok(await page.getByText("new target B").count() > 0, "target-B context should render");
  assert.ok(maxActive <= 4, `backlink reads exceeded concurrency bound: ${maxActive}`);
  console.log(`PASS backlink context: stale switch, concurrency <=4 (${maxActive}), failed/slow reads do not block remaining context`);
} finally { await page.close(); await browser.close(); await server.close(); }
