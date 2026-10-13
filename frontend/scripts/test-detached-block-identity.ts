import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const bundle = await build({
  stdin: { contents: `export {getSchema} from '@tiptap/core';export {EditorState,AllSelection,Selection} from '@tiptap/pm/state';export {DOMParser,Fragment} from '@tiptap/pm/model';export {Mapping,StepMap} from '@tiptap/pm/transform';export {contentExtensions} from './extensions/content-schema';export {nativeBlockFormat} from './lib/native-block-format';export {serializeModel} from './lib/segment-model';export {identifyTouchedBlocks,identifyTouchedBlocksWork} from './extensions/block-identity';export {finishEditWork,scheduleEditWork} from './lib/edit-work';`, resolveDir: fileURLToPath(new URL("../src/", import.meta.url)), loader: "ts" },
  bundle: true, write: false, format: "iife", globalName: "fixture", platform: "browser",
  loader: { ".css": "empty" }, external: ["mermaid", "@google/model-viewer"],
  define: { "process.env.NODE_ENV": '"production"' }, logLevel: "error",
});
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  await page.route("https://detached-identity.test/**", route => route.fulfill({ contentType: "text/html", body: "<body></body>" }));
  await page.goto("https://detached-identity.test/"); await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(async () => {
    const f = (window as any).fixture, schema = f.getSchema(f.contentExtensions()), encoder = new TextEncoder();
    const eq = (a: any, b: any, label: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw Error(label); };
    const ok = (value: any, label: string) => { if (!value) throw Error(label); };
    const parse = (html: string) => { const template = document.createElement("template"); template.innerHTML = html; return f.DOMParser.fromSchema(schema).parse(template.content, { preserveWhitespace: "full" }); };
    const state = (html: string) => { const doc = parse(html); return f.EditorState.create({ doc, selection: new f.AllSelection(doc) }); };
    const normalize = (value: any) => JSON.parse(JSON.stringify(value).replace(/ink-block-[0-9a-f-]{36}/g, "NEW_ID"));
    let cases = 0;
    const compare = (doc: any, mapping: any, options: any = {}, selection?: any, fast?: boolean) => {
      const expected = f.identifyTouchedBlocks(doc, mapping, options);
      let slices = 0; const originalSlice = mapping.slice;
      mapping.slice = function(...args: any[]) { slices++; return originalSlice.apply(this, args); };
      let actual; try { actual = f.finishEditWork(f.identifyTouchedBlocksWork(doc, mapping, options)); }
      finally { mapping.slice = originalSlice; }
      eq(normalize(actual.toJSON()), normalize(expected.toJSON()), "exact synchronous oracle model parity case " + cases);
      eq(actual.nodeSize, doc.nodeSize, "attributes keep node size");
      const actualHTML = f.serializeModel(actual.content), expectedHTML = f.serializeModel(expected.content);
      eq(normalize(actualHTML), normalize(expectedHTML), "exact serialized source parity");
      eq(encoder.encode(actualHTML).length, encoder.encode(expectedHTML).length, "exact UTF-8 source extent");
      const ids: string[] = []; actual.descendants((node: any) => { if (node.attrs.id) ids.push(node.attrs.id); });
      eq(new Set(ids).size, ids.length, "identities remain unique");
      if (selection) eq(f.Selection.fromJSON(actual, selection.toJSON()).toJSON(), selection.toJSON(), "native selection positions remain valid");
      if (fast !== undefined) ok(fast ? slices === 0 : slices > 0, "integer map fast path eligibility case " + cases + " slices=" + slices);
      cases++; return actual;
    };
    const base = '<p id="stable" dir="rtl">앞 한😀</p><p>Alpha <strong>Beta</strong></p><h2>Heading</h2><blockquote><p>Nested</p><p id="inner-stable">Tail</p></blockquote><ul><li><p>Item</p></li></ul><table><tbody><tr><td><p>Cell</p></td></tr></tbody></table>';
    for (const operation of [{ kind: "block", type: "heading", level: 1, toggle: false }, { kind: "block", type: "codeBlock", language: "rust" }]) {
      const tr = f.nativeBlockFormat(state(base), operation);
      compare(tr.doc, tr.mapping, {}, tr.selection, true);
      compare(tr.doc, tr.mapping, { from: 12, to: tr.doc.content.size - 10 }, tr.selection, true);
      tr.insertText("입력😀", 2, 3); compare(tr.doc, tr.mapping, {}, tr.selection, false);
      compare(tr.doc, tr.mapping, { first: tr.mapping.maps.length - 1 }, tr.selection, false);
    }
    const simple = state('<p>One</p><p>Two</p><p id="untouched">Three</p>');
    const blockFrom = simple.doc.child(0).nodeSize, blockTo = blockFrom + simple.doc.child(1).nodeSize;
    const removed = simple.tr.delete(blockFrom, blockTo);
    const removedIDs = compare(removed.doc, removed.mapping, {}, removed.selection);
    eq(removedIDs.toJSON(), removed.doc.toJSON(), "whole block deletion leaves both neighbours untouched");
    const joined = simple.tr.delete(3, blockFrom + 2); compare(joined.doc, joined.mapping, {}, joined.selection, false);
    const inserted = simple.tr.insert(blockFrom, schema.nodes.paragraph.create(null, schema.text("New😀")));
    const insertion = compare(inserted.doc, inserted.mapping, {}, inserted.selection, false);
    eq(insertion.child(0).attrs.id, null, "inserted block does not identify the preceding neighbour");
    eq(insertion.child(2).attrs.id, null, "inserted block does not identify the following neighbour");
    const sameSize = simple.tr.replaceWith(2, 4, schema.text("XY")); compare(sameSize.doc, sameSize.mapping, {}, sameSize.selection, false);
    compare(sameSize.doc, sameSize.mapping, { first: -1 }, sameSize.selection, false);
    compare(sameSize.doc, sameSize.mapping, { first: 0.5 }, sameSize.selection);
    const mirror = new f.Mapping(); mirror.appendMap(new f.StepMap([1, 1, 1])); mirror.appendMap(new f.StepMap([1, 1, 1]), 0);
    compare(simple.doc, mirror, {}, simple.selection, false);
    const unchanged = compare(simple.doc, new f.Mapping(), {}, simple.selection);
    ok(unchanged === simple.doc, "no maps keeps the original immutable document");

    // Deterministic mixed replay sequences exercise mapping biases and opening
    // position bounds against the retained synchronous implementation.
    let random = 42; const pick = (max: number) => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random % max; };
    for (let i = 0; i < 40; i++) {
      const original = state(base), tr = original.tr;
      for (let step = 0; step < 4; step++) {
        const positions: number[] = [];
        tr.doc.descendants((node: any, at: number) => { if (node.isText) for (let offset = 0; offset < node.text.length; offset++) if (!(/[\uD800-\uDBFF]/.test(node.text[offset - 1] ?? "") && /[\uDC00-\uDFFF]/.test(node.text[offset]))) positions.push(at + offset); });
        const at = positions[pick(positions.length)];
        if (pick(3) === 0) tr.insertText("X😀", at); else tr.insertText("Z", at, Math.min(at + 1, tr.doc.resolve(at).end()));
      }
      compare(tr.doc, tr.mapping, { first: i % 3, from: i % 9, to: tr.doc.content.size - i % 7 }, tr.selection);
    }

    const benchmarks: any[] = [];
    for (const identity of ["none", "some", "all"]) {
      const nodes: any[] = [], maps: any[] = []; let pos = 0;
      for (let i = 0; i < 10000; i++) {
        const attrs = { level: 2, id: identity === "all" || identity === "some" && i % 4 === 0 ? "existing-" + i : null };
        const node = schema.nodes.heading.create(attrs, schema.text("한글😀 " + i)); nodes.push(node);
        maps.push(new f.StepMap([pos, 1, 1, pos + node.nodeSize - 1, 1, 1])); pos += node.nodeSize;
      }
      const doc = schema.topNodeType.create(null, f.Fragment.fromArray(nodes)), mapping = new f.Mapping(maps);
      let ticks = 0, maxGap = 0, previous = performance.now();
      const timer = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - previous); previous = now; ticks++; }, 16);
      const start = performance.now(); let actual;
      try { actual = await f.scheduleEditWork(f.identifyTouchedBlocksWork(doc, mapping), () => {}); }
      finally { maxGap = Math.max(maxGap, performance.now() - previous); clearInterval(timer); }
      const elapsed = performance.now() - start;
      const generated: string[] = []; actual.descendants((node: any, at: number) => {
        if (node.attrs.id) generated.push(node.attrs.id);
        if (node.type.name === "heading") { const sourceNode = doc.nodeAt(at); if (sourceNode.attrs.id) eq(node.attrs.id, sourceNode.attrs.id, "10k existing identities stay exact"); }
      });
      eq(generated.length, 10000, "10k headings identified"); eq(new Set(generated).size, 10000, "10k identities unique");
      eq(actual.nodeSize, doc.nodeSize, "10k source extent unchanged");
      ok(maxGap < 250, "10k identity work must not freeze a frame for hundreds of milliseconds: " + maxGap);
      benchmarks.push({ identity, ms: Math.round(elapsed * 10) / 10, ticks, maxGapMS: Math.round(maxGap * 10) / 10 });
      if (identity === "none") {
        const snapshot = doc.toJSON(); let cancelled = false, checks = 0, rejected = false;
        const cancel = setTimeout(() => { cancelled = true; }, 10);
        try { await f.scheduleEditWork(f.identifyTouchedBlocksWork(doc, mapping), () => { checks++; if (cancelled) throw Error("cancelled identity batch"); }); }
        catch (error) { rejected = (error as Error).message === "cancelled identity batch"; }
        finally { clearTimeout(cancel); }
        ok(rejected && checks > 1, "large identity work respects cancellation between batches"); eq(doc.toJSON(), snapshot, "cancelled work keeps its immutable input exact");
      }
    }
    return { cases, benchmarks };
  });
  assert.equal(result.cases, 56);
  console.log("PASS detached identity batches: synchronous oracle parity, integer/mirrored/replay maps, exact existing IDs/UTF-8 extents, untouched neighbours, 10k responsiveness and cancellation", JSON.stringify(result));
} finally { await browser.close(); }
