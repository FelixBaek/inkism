import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { chromium } from './browser-env.ts';

const workerStub = { name: "worker-stub", setup(b: any) {
  b.onResolve({ filter: /\?worker$/ }, (a: any) => ({ path: a.path, namespace: "worker-stub" }));
  b.onLoad({ filter: /.*/, namespace: "worker-stub" }, () => ({ contents: "export default class{}", loader: "js" }));
} };
const bundle = await build({
  stdin: { contents: `export {EditorState,TextSelection,NodeSelection} from '@tiptap/pm/state';export {Slice,Fragment} from '@tiptap/pm/model';export {prepareSelection,changeSelection} from './lib/document-selection';export {segmentPositionMap} from './lib/segment-selection';export {inspectSegment} from './lib/rich-segment';export {previewSourceRegion,previewSelectionRegion} from './lib/selection-preview';export {WindowHistory} from './lib/window-history';`, resolveDir: fileURLToPath(new URL("../src/", import.meta.url)), loader: "ts" },
  bundle: true, write: false, format: "iife", globalName: "fixture", platform: "browser",
  loader: { ".css": "empty" }, external: ["mermaid", "@google/model-viewer"], plugins: [workerStub],
  define: { "process.env.NODE_ENV": '"production"' }, logLevel: "error",
});
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  await page.route("https://node-selection.test/**", r => r.fulfill({ contentType: "text/html", body: "<body></body>" }));
  await page.goto("https://node-selection.test/"); await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(async () => {
    const f = (window as any).fixture, enc = new TextEncoder(), dec = new TextDecoder();
    // Obtain the API's actual schema: PM node types from a separately created
    // schema cannot participate in the detached model's equality checks.
    const seed = await f.prepareSelection({ kind: "all" }, {
      read: async () => ({ blocks: [{ ordinal: 0, byte_offset: 0, html: "<p>seed</p>" }], next_offset: null, total_blocks: 1, ready: true }), check() {},
    });
    const schema = seed.state.schema;
    const prefix = '<p>머리 &#128512;</p><p>' + "앞".repeat(37) + "😀";
    const suffix = '다음 </p><p>꼬리 &amp;😀</p>', tagAt = enc.encode(prefix.slice(0, prefix.lastIndexOf("<p>"))).length;
    const byteStart = enc.encode(prefix).length;
    const eq = (a: any, b: any, label: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw Error(label); };
    const ok = (value: any, label: string) => { if (!value) throw Error(label); };
    const cases = [
      { name: "short UTF-8", raw: "한글😀&amp; ABCDEFGHIJ", anchor: 10, latex: "x+1" },
      { name: "far node", raw: "A".repeat(35000) + "BCDEFGHIJ", anchor: 35003, latex: "x+1" },
      { name: "split atom", raw: "A".repeat(16360) + "BCDEFGHIJ" + "Z".repeat(35000), anchor: 16361, latex: "x+1" },
      { name: "long split atom", raw: "A".repeat(16360) + "BCDEFGHIJ" + "Z".repeat(35000), anchor: 16361, latex: "x".repeat(8192) },
      { name: "beyond DOM limit", raw: "A".repeat(150000) + "BCDEFGHIJ", anchor: 150003, latex: "x+1" },
    ];
    let maxPreview = 0;
    for (const test of cases) {
      const context = [{ tag: "p", open: "<p>", at: tagAt }];
      const region = { ordinal: 3, byte_offset: byteStart, source: test.raw, start_context: context, end_context: context };
      const map = f.segmentPositionMap(region, schema), doc = map.doc();
      const state = f.EditorState.create({ doc, selection: f.TextSelection.create(doc, test.anchor, test.anchor + 2) });
      const atom = schema.nodes.inlineMath.create({ latex: test.latex }), slice = new f.Slice(f.Fragment.from(atom), 0, 0);
      const native = state.tr.replaceSelection(slice); let atomAt = -1;
      native.doc.descendants((node: any, at: number) => { if (node.type.name === "inlineMath") atomAt = at; });
      const selected = f.NodeSelection.create(native.doc, atomAt);
      const prepared = {
        byteStart, before: test.raw, state, blockOffset: 1, blockCount: 1,
        preview: "", previewCount: 1, previewWindow: { html: "", count: 1 },
        fragments: [{ segment: region, shift: 0, from: 1, to: doc.content.size - 1 }],
        region, segmentTotal: 100, previewSelection: state.selection.toJSON(), check() {},
      };
      let changed;
      try { changed = f.changeSelection(prepared, { kind: "replay", slice: slice.toJSON(), head: native.selection.head, steps: [], selection: selected.toJSON() }); }
      catch (error) { throw Error(test.name + ": " + (error as Error).message); }
      eq(changed.tags.length, 1, test.name + " parent identity splice");
      eq(changed.tags[0].start, tagAt, test.name + " exact UTF-8 tag offset");
      eq(changed.tags[0].expected, "<p>", test.name + " narrow outside tag write");
      const growth = enc.encode(changed.tags[0].replacement).length - 3;
      eq(changed.start, byteStart + growth, test.name + " rebased body position");
      const preview = changed.previewWindow;
      ok(preview.byteStart >= changed.start, test.name + " preview follows rebased body");
      eq(preview.internal.byte_offset, preview.byteStart, test.name + " matching source/preview offsets");
      eq(preview.internal.start_context[0].at, tagAt, test.name + " parent tag remains at its own position");
      const previewBytes = enc.encode(preview.raw).length; maxPreview = Math.max(maxPreview, previewBytes);
      ok(previewBytes <= 32768, test.name + " bounded preview");
      const shownRegion = { ...preview.internal, source: preview.raw };
      const shownMap = f.segmentPositionMap(shownRegion, schema), shownDoc = shownMap.doc();
      const restored = f.NodeSelection.fromJSON(shownDoc, changed.selection);
      eq(restored.node.toJSON(), atom.toJSON(), test.name + " exact selected atom");
      ok(restored.to <= shownDoc.content.size, test.name + " valid mounted selection");
      eq(changed.documentSelection, null, test.name + " native node selection is not a text document range");

      // Replay the sequential byte edits independently, then persist/reload
      // their history in the string coordinate format used by nonpaged drafts.
      const original = prefix + test.raw + suffix, edits = [...changed.tags, { start: changed.start, expected: changed.expected, replacement: changed.replacement }];
      let body = original; const stringEdits: any[] = [];
      for (const edit of edits) {
        const raw = enc.encode(body), end = edit.start + enc.encode(edit.expected).length;
        eq(dec.decode(raw.subarray(edit.start, end)), edit.expected, test.name + " sequential edit precondition");
        stringEdits.push({ ...edit, start: dec.decode(raw.subarray(0, edit.start)).length });
        body = dec.decode(raw.subarray(0, edit.start)) + edit.replacement + dec.decode(raw.subarray(end));
      }
      eq(body.slice(0, prefix.lastIndexOf("<p>")), original.slice(0, prefix.lastIndexOf("<p>")), test.name + " untouched Unicode/entity prefix");
      ok(body.endsWith(suffix), test.name + " untouched suffix");
      const history = new f.WindowHistory();
      history.record({ from: stringEdits[0].start, offset: 1, before: "", after: "", edits: stringEdits, beforeCount: 1, afterCount: 1, afterPreview: preview, afterSelection: changed.selection, session: 1, group: 0, time: 1 });
      const loaded = f.WindowHistory.restore(history.serialize());
      eq(loaded.apply("undo", body).content, original, test.name + " restart Undo restores exact source");
      const redo = loaded.apply("redo", original); eq(redo.content, body, test.name + " restart Redo restores same identity");
      eq(f.NodeSelection.fromJSON(shownDoc, redo.selection).node.toJSON(), atom.toJSON(), test.name + " history restores selected atom");
      if (enc.encode(changed.replacement).length < 128 * 1024) {
        const fullMap = f.segmentPositionMap({ ...region, byte_offset: changed.start, source: changed.replacement, start_context: preview.internal.start_context, end_context: preview.internal.end_context }, schema);
        const direct = f.previewSelectionRegion({ ...region, byte_offset: changed.start, source: changed.replacement, start_context: preview.internal.start_context, end_context: preview.internal.end_context }, selected.toJSON(), schema, 1, 100);
        ok(direct, test.name + " direct node preview");
        eq(fullMap.doc().nodeAt(selected.from).toJSON(), atom.toJSON(), test.name + " canonical fitted atom position");
      }
    }
    return { cases: cases.length, maxPreview };
  });
  assert.equal(result.cases, 5); assert.ok(result.maxPreview <= 32768);
  console.log("PASS node selection previews: UTF-8 rebasing, far atom, seam-spanning atom, large serialization, bounded mounted selection and restart Undo/Redo", JSON.stringify(result));
} finally { await browser.close(); }
