/**
 * 테스트/개발용 프로토콜 v1 목업 엔진 + 정적 자산 서버.
 * 실제 런타임에는 Go 셸이 이 역할을 대신한다. 프런트엔드 빌드/테스트 보조 도구일 뿐이다.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function createMockEngine() {
  const notes = new Map(); // id -> Note
  const notebooks = [];
  const historyByNote = new Map(); // id -> entries[]
  const indexJobs = []; // 색인 지연 시뮬레이션용
  let trashDays = null;

  const now = () => Date.now();
  const summary = (n) => {
    const { content, text, ...rest } = n;
    return { ...rest, preview: (text || "").replace(/\s+/g, " ").trim().slice(0, 180) };
  };
  const sortNotes = (arr) =>
    arr.sort((a, b) => b.pinned - a.pinned || b.updated_at - a.updated_at || (a.id < b.id ? 1 : -1));
  const encodeCursor = (n) => Buffer.from(JSON.stringify([n.updated_at, n.id])).toString("base64");
  const decodeCursor = (c) => {
    try {
      const [u, id] = JSON.parse(Buffer.from(c, "base64").toString());
      return { u, id };
    } catch {
      return null;
    }
  };

  function pushHistory(n) {
    const list = historyByNote.get(n.id) ?? [];
    list.unshift({ id: crypto.randomUUID(), note_id: n.id, title: n.title, created_at: now(), content: n.content, text: n.text, content_format: n.content_format ?? "html", note_revision: n.revision });
    if (list.length > 20) list.length = 20;
    historyByNote.set(n.id, list);
  }

  function opSave(args) {
    const n = args.note;
    if (!n || typeof n !== "object") throw new Error("note 객체가 필요합니다");
    if (!n.id) throw new Error("id가 필요합니다");
    const existing = notes.get(n.id);
    if (existing) {
      if (typeof n.revision === "number" && n.revision !== existing.revision) {
        throw new Error("revision conflict: 노트가 다른 곳에서 변경되었습니다");
      }
      existing.title = n.title ?? existing.title;
      existing.content = n.content ?? existing.content;
      existing.text = n.text ?? existing.text;
      if (n.notebook_id !== undefined) existing.notebook_id = n.notebook_id;
      if (n.tags !== undefined) existing.tags = n.tags;
      existing.revision++;
      existing.updated_at = now();
      pushHistory(existing);
      queueIndex();
      return existing;
    }
    const note = {
      id: n.id,
      title: n.title ?? "",
      content: n.content ?? "",
      text: n.text ?? "",
      notebook_id: n.notebook_id ?? null,
      tags: n.tags ?? [],
      favorite: false,
      pinned: false,
      archived: false,
      trashed: false,
      color: "",
      created_at: now(),
      updated_at: now(),
      revision: 0,
    };
    notes.set(note.id, note);
    pushHistory(note);
    queueIndex();
    return note;
  }

  function queueIndex() {
    indexJobs.push({ at: now() });
    // 색인 지연: 작업당 ~1.2초 후 처리 (index_status UI 테스트용)
    setTimeout(() => indexJobs.shift(), 1200).unref?.();
  }

  function opList(args) {
    let pool = [...notes.values()];
    const view = args.view ?? "all";
    if (view === "all") pool = pool.filter((n) => !n.trashed && !n.archived);
    else if (view === "favorites") pool = pool.filter((n) => n.favorite && !n.trashed && !n.archived);
    else if (view === "archive") pool = pool.filter((n) => n.archived && !n.trashed);
    else if (view === "trash") pool = pool.filter((n) => n.trashed);
    if (args.notebook_id) pool = pool.filter((n) => n.notebook_id === args.notebook_id);
    if (args.tag) pool = pool.filter((n) => n.tags.includes(args.tag));
    const q = (args.query ?? "").trim().toLowerCase();
    if (q) pool = pool.filter((n) => n.title.toLowerCase().includes(q) || n.text.toLowerCase().includes(q));
    sortNotes(pool);
    if (args.cursor) {
      const key = decodeCursor(args.cursor);
      if (key) {
        const idx = pool.findIndex((n) => n.updated_at === key.u && n.id === key.id);
        if (idx >= 0) pool = pool.slice(idx + 1);
      }
    }
    const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 100);
    const page = pool.slice(0, limit);
    const next = pool.length > limit ? encodeCursor(page[page.length - 1]) : null;
    return { items: page.map(summary), next_cursor: next };
  }

  const ops = {
    list: opList,
    get: ({ id }) => {
      const n = notes.get(id);
      if (!n) throw new Error("노트를 찾을 수 없습니다");
      return n;
    },
    save: opSave,
    patch: ({ id, changes }) => {
      const n = notes.get(id);
      if (!n) throw new Error("노트를 찾을 수 없습니다");
      const allowed = ["favorite", "pinned", "archived", "trashed", "color", "notebook_id", "tags"];
      for (const k of allowed) if (k in changes) n[k] = changes[k];
      n.updated_at = now();
      return n;
    },
    delete: ({ id }) => {
      const n = notes.get(id);
      if (!n) throw new Error("노트를 찾을 수 없습니다");
      if (!n.trashed) throw new Error("지운 노트만 삭제할 수 있습니다");
      notes.delete(id);
      historyByNote.delete(id);
      return { deleted: true };
    },
    notebooks: () => notebooks,
    save_notebook: (args) => {
      if (args.id) {
        const nb = notebooks.find((x) => x.id === args.id);
        if (!nb) throw new Error("폴더를 찾을 수 없습니다");
        nb.name = args.name ?? nb.name;
        nb.color = args.color ?? nb.color;
        return nb;
      }
      const nb = { id: crypto.randomUUID(), name: args.name, color: args.color ?? "#087f5b" };
      notebooks.push(nb);
      return nb;
    },
    delete_notebook: ({ id }) => {
      const i = notebooks.findIndex((x) => x.id === id);
      if (i >= 0) notebooks.splice(i, 1);
      for (const n of notes.values()) if (n.notebook_id === id) n.notebook_id = null;
      return { deleted: true };
    },
    tags: () => {
      const counts = new Map();
      for (const n of notes.values()) {
        if (n.trashed || n.archived) continue;
        for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
      }
      return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
    },
    notebook_counts: () => {
      const counts = {};
      for (const n of notes.values()) if (n.notebook_id && !n.trashed && !n.archived) counts[n.notebook_id] = (counts[n.notebook_id] ?? 0) + 1;
      return counts;
    },
    trash_retention_get: () => ({ days: trashDays }),
    trash_retention_set: ({ days }) => ((trashDays = days ?? null), { days: trashDays }),
    // 목업은 지운 시각을 따로 두지 않고 마지막 수정 시각을 쓴다.
    trash_times: ({ ids }) => ({ days: trashDays, times: Object.fromEntries(ids.filter((id) => notes.get(id)?.trashed).map((id) => [id, notes.get(id).updated_at])) }),
    trash_purge: () => ({ deleted: [], more: false }),
    stats: () => {
      const all = [...notes.values()];
      return {
        notes: all.filter((n) => !n.trashed && !n.archived).length,
        favorites: all.filter((n) => n.favorite && !n.trashed && !n.archived).length,
        archive: all.filter((n) => n.archived && !n.trashed).length,
        trash: all.filter((n) => n.trashed).length,
      };
    },
    history: ({ id }) => (historyByNote.get(id) ?? []).map(({ content, text, ...entry }) => entry),
    revision_body: ({ id, revision }) => {
      const n = notes.get(id);
      if (n && n.revision === revision) return { revision, content: n.content, content_format: n.content_format ?? "html" };
      const entry = (historyByNote.get(id) ?? []).find((h) => h.note_revision === revision);
      if (!entry) throw new Error("편집 기준 버전이 이력에 없습니다");
      return { revision, content: entry.content, content_format: entry.content_format };
    },
    restore: ({ id, history_id }) => {
      const n = notes.get(id);
      const list = historyByNote.get(id) ?? [];
      const entry = list.find((h) => h.id === history_id);
      if (!n || !entry) throw new Error("기록을 찾을 수 없습니다");
      n.title = entry.title;
      n.content = entry.content;
      n.text = entry.text;
      n.revision++;
      n.updated_at = now();
      pushHistory(n);
      return n;
    },
    health: () => ({ version: "mock-1.0.0" }),
    index_status: () => ({ pending: indexJobs.length }),
    backlinks: ({ id }) => {
      const items = [];
      for (const n of notes.values()) {
        if (n.id === id) continue;
        if (n.content.includes(id)) items.push(summary(n));
      }
      return { items };
    },
  };

  return { notes, notebooks, historyByNote, ops };
}

export function startServer({ port = 47831, staticDir = null } = {}) {
  const engine = createMockEngine();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (req.method === "POST" && url.pathname === "/api/rpc") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          const { op, ...args } = JSON.parse(body);
          const fn = engine.ops[op];
          if (!fn) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: `알 수 없는 op: ${op}` }));
            return;
          }
          const data = fn(args);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, data }));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
        }
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/info") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ name: "inkism-native", version: "0.1.0-mock", platform: "test" }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/import") {
      let body = [];
      req.on("data", (c) => body.push(c));
      req.on("end", () => {
        try {
          const buf = Buffer.concat(body);
          const text = extractMultipartFile(buf, req.headers["content-type"] ?? "");
          const data = JSON.parse(text);
          if (data.version !== 1 || !Array.isArray(data.notes)) throw new Error("잘못된 백업 형식");
          let imported = 0;
          for (const n of data.notes) {
            const fresh = { ...n, id: crypto.randomUUID() };
            engine.notes.set(fresh.id, fresh);
            imported++;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, imported }));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
        }
      });
      return;
    }
    // 정적 자산 (빌드된 프런트엔드) — Go 셸 역할 시뮬레이션
    if (staticDir && req.method === "GET") {
      let p = url.pathname === "/" ? "/index.html" : url.pathname;
      const file = path.join(staticDir, path.normalize(p).replace(/^([.][.][/\\])+/, ""));
      if (file.startsWith(staticDir) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        const ext = path.extname(file);
        const mime =
          { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2" }[ext] ??
          "application/octet-stream";
        res.writeHead(200, { "Content-Type": mime });
        fs.createReadStream(file).pipe(res);
        return;
      }
      // SPA fallback
      const index = path.join(staticDir, "index.html");
      if (fs.existsSync(index)) {
        res.writeHead(200, { "Content-Type": "text/html" });
        fs.createReadStream(index).pipe(res);
        return;
      }
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  });

  return new Promise<{ server: typeof server; engine: typeof engine }>((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve({ server, engine }));
  });
}

function extractMultipartFile(buf, contentType) {
  const m = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  if (!m) return buf.toString("utf8"); // multipart가 아니면 원문 시도
  const boundary = "--" + (m[1] || m[2]);
  const parts = buf.toString("binary").split(boundary);
  for (const part of parts) {
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;
    const headers = part.slice(0, headerEnd);
    if (/name="file"/.test(headers)) {
      let content = part.slice(headerEnd + 4);
      if (content.endsWith("\r\n")) content = content.slice(0, -2);
      return Buffer.from(content, "binary").toString("utf8");
    }
  }
  throw new Error("multipart에서 파일을 찾을 수 없습니다");
}

// 직접 실행: node scripts/mock-server.ts [port]
if (process.argv[1] && process.argv[1].endsWith("mock-server.ts")) {
  const port = Number(process.argv[2]) || 47831;
  const dist = new URL("../dist", import.meta.url).pathname;
  const s = await startServer({ port, staticDir: fs.existsSync(dist) ? dist : null });
  console.log(`mock engine + static on http://127.0.0.1:${port} (dist: ${fs.existsSync(dist)})`);
  process.on("SIGINT", () => {
    s.server.close();
    process.exit(0);
  });
}
