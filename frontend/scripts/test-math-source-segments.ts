import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { modelSourceSegments } from "../src/lib/source-segments.ts";

const latex = "x".repeat(8192), atom = `<span data-latex="${latex}" data-type="inline-math">${latex}</span>`;
const block = `<div data-latex="${latex}" data-type="block-math">${latex}</div>`;
const cases = [
  { name: "inline math", source: '<p id="stable">' + "A".repeat(16360) + atom + "Z".repeat(35000) + "</p>", atomic: true },
  { name: "block math", source: '<p>한😀&amp;</p>' + block + '<p>尾&#128512;</p>', atomic: true },
  { name: "ordinary span", source: `<p><span title='data-type="inline-math"'>${"A".repeat(35000)}</span></p>`, atomic: false },
  { name: "noncanonical nested math", source: `<p><span data-type="inline-math"><strong>${"A".repeat(35000)}</strong></span></p>`, atomic: false },
];
const context = [{ tag: "blockquote", open: '<blockquote id="outer">', at: 7 }], byteOffset = 123;
const expected = cases.map(test => {
  const parts = [...modelSourceSegments(test.source, byteOffset, context)];
  assert.equal(parts.map(part => part.source).join(""), test.source, test.name + " preserves exact source bytes");
  let at = byteOffset;
  for (const part of parts) {
    assert.equal(part.byte_offset, at, test.name + " contiguous UTF-8 cursor");
    assert.ok(Buffer.byteLength(part.source) <= 32768, test.name + " bounded source");
    at += Buffer.byteLength(part.source);
    assert.deepEqual(part.start_context[0], context[0]);
    if (test.atomic) assert.ok(![...part.start_context, ...part.end_context].some(a => /data-type="(?:inline|block)-math"/.test(a.open)), test.name + " never cuts inside the leaf");
  }
  if (!test.atomic) assert.ok(parts.some(part => part.end_context.some(a => a.tag === "span")), test.name + " retains ordinary wrapper cuts");
  return parts;
});
const oversized = `<span data-type="inline-math" data-latex="${"한".repeat(8192)}">${"한".repeat(8192)}</span>`;
assert.throws(() => [...modelSourceSegments(oversized, 0)], /큰 서식 토큰/, "an atom larger than the source bound is rejected before a partial model is exposed");
assert.throws(() => [...modelSourceSegments(atom, 0, [], [20])], /토큰 내부/, "forced cuts cannot split math attributes or text");

// Exercise the real worker entry rather than another copy of its loop.
const bundle = await build({ entryPoints: [fileURLToPath(new URL("../src/workers/source-segments.worker.ts", import.meta.url))], bundle: true, write: false, format: "iife", platform: "browser", logLevel: "error" });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage(); await page.goto("about:blank");
  const actual = await page.evaluate(async ({ code, cases, byteOffset, context, oversized }) => {
    const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    const run = (source: string) => new Promise<any>((resolve, reject) => {
      const worker = new Worker(url);
      worker.onmessage = event => { worker.terminate(); resolve(event.data); };
      worker.onerror = error => { worker.terminate(); reject(Error(error.message)); };
      worker.postMessage({ source, byteOffset, context });
    });
    try { return { values: await Promise.all(cases.map(test => run(test.source))), oversized: await run(oversized) }; }
    finally { URL.revokeObjectURL(url); }
  }, { code: bundle.outputFiles[0].text, cases, byteOffset, context, oversized });
  actual.values.forEach((result, index) => {
    assert.equal(result.error, undefined, cases[index].name);
    assert.deepEqual(result.spans.map(({ from, to, ...part }) => ({ ...part, source: cases[index].source.slice(from, to) })), expected[index], cases[index].name + " identical sync/worker segments");
  });
  assert.ok(actual.oversized.error); assert.equal(actual.oversized.spans, undefined);
  console.log("PASS source segments: canonical math leaves remain whole in sync and real worker scans, exact Unicode offsets/contexts, ordinary wrapper preservation and oversized atom refusal");
} finally { await browser.close(); }
