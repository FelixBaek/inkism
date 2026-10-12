#!/usr/bin/env node
/**
 * Small, dependency-free headless client for the packaged Inkism runtime.
 * The runtime already exposes a JSONL protocol; this keeps that protocol
 * usable from scripts without starting the desktop window.
 */
import { spawn } from "node:child_process";
import { once } from "node:events";

function usage(code = 0) {
  const out = `Inkism headless CLI

Usage:
  inkism-cli.mjs --db PATH [--engine PATH] list [--view all|archive|trash|favorites]
  inkism-cli.mjs --db PATH [--engine PATH] get NOTE_ID
  inkism-cli.mjs --db PATH [--engine PATH] sync status|now|pause [--paused true|false]
  inkism-cli.mjs --db PATH [--engine PATH] request JSON

The command reads one response from inkism-engine and writes JSON to stdout.
It does not open a window and never creates a library implicitly.
`;
  (code ? console.error : console.log)(out);
  process.exit(code);
}

const args = process.argv.slice(2);
let db = "", engine = process.env.INKISM_ENGINE || "inkism-engine";
while (args[0]?.startsWith("--")) {
  const flag = args.shift();
  if (flag === "--help") usage();
  const value = args.shift();
  if (!value || value.startsWith("--")) { console.error(`${flag} requires a value`); usage(2); }
  if (flag === "--db") db = value;
  else if (flag === "--engine") engine = value;
  else { console.error(`unknown option: ${flag}`); usage(2); }
}
if (!db || !args.length) { console.error("--db and a command are required"); usage(2); }

const command = args.shift();
let request;
if (command === "list") {
  let view = "all";
  while (args.length) {
    const flag = args.shift();
    if (flag !== "--view") { console.error(`unknown list option: ${flag}`); process.exit(2); }
    view = args.shift() || "";
  }
  if (!["all", "archive", "trash", "favorites"].includes(view)) { console.error("invalid view"); process.exit(2); }
  request = { op: "list", view, limit: 100 };
} else if (command === "get") {
  if (!args[0] || args.length > 1) { console.error("get requires exactly one note ID"); process.exit(2); }
  request = { op: "get", id: args[0] };
} else if (command === "sync") {
  const action = args.shift();
  if (action === "status") request = { op: "sync_status" };
  else if (action === "now") request = { op: "sync_now" };
  else if (action === "pause") {
    if (args.length !== 2 || args[0] !== "--paused" || !["true", "false"].includes(args[1])) {
      console.error("sync pause requires --paused true|false"); process.exit(2);
    }
    request = { op: "sync_pause", paused: args[1] === "true" };
  } else { console.error("sync requires status, now, or pause"); process.exit(2); }
} else if (command === "request") {
  if (args.length !== 1) { console.error("request requires one JSON object"); process.exit(2); }
  try { request = JSON.parse(args[0]); } catch { console.error("request JSON is invalid"); process.exit(2); }
  if (!request || typeof request !== "object" || Array.isArray(request)) { console.error("request must be a JSON object"); process.exit(2); }
} else { console.error(`unknown command: ${command}`); usage(2); }

const child = spawn(engine, ["--db", db], { stdio: ["pipe", "pipe", "inherit"] });
let buffer = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", chunk => { buffer += chunk; });
child.stdin.write(JSON.stringify(request) + "\n");
child.stdin.end();
const [status] = await once(child, "close");
const line = buffer.split(/\r?\n/).find(value => value.trim());
if (!line) { console.error(`inkism-engine exited without a response (${status})`); process.exit(status || 1); }
try {
  const response = JSON.parse(line);
  console.log(JSON.stringify(response, null, 2));
  process.exit(response.ok === false ? 1 : 0);
} catch {
  console.error("inkism-engine returned invalid JSON"); process.exit(1);
}
