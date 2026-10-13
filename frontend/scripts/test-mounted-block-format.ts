import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { chromium } from './browser-env.ts';

const bundle = await build({
  stdin: {
    contents: `export {Editor,Extension} from '@tiptap/core';export {AllSelection} from '@tiptap/pm/state';export {undoDepth} from '@tiptap/pm/history';export {contentExtensions} from './extensions/content-schema';export {markdownContentExtensions} from './lib/markdown-compatible';export {mountedBlockFormat} from './lib/mounted-block-format';`,
    resolveDir: fileURLToPath(new URL("../src/", import.meta.url)),
    loader: "ts",
  },
  bundle: true, write: false, format: "iife", globalName: "fixture", platform: "browser",
  loader: { ".css": "empty" }, external: ["mermaid", "@google/model-viewer"],
  define: { "process.env.NODE_ENV": '"production"' }, logLevel: "error",
});
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  await page.route("https://mounted.test/**", r => r.fulfill({ contentType: "text/html", body: '<div id="editor"></div>' }));
  await page.goto("https://mounted.test/");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const results = await page.evaluate(() => {
    const f = (window as any).fixture;
    const commands = f.Extension.create({
      name: "mountedFormats", priority: 50,
      addCommands() {
        const run = (operation: any) => (props: any) => f.mountedBlockFormat(props, operation);
        return {
          setHeading: (attrs: any) => run({ kind: "block", type: "heading", level: attrs.level, toggle: false }),
          toggleHeading: (attrs: any) => run({ kind: "block", type: "heading", level: attrs.level, toggle: true }),
          setParagraph: () => run({ kind: "block", type: "paragraph" }),
          toggleCodeBlock: (attrs: any = {}) => run({ kind: "block", type: "codeBlock", language: attrs.language }),
        };
      },
    });
    const create = (content: string, markdown = false) => new f.Editor({
      element: document.querySelector("#editor"),
      extensions: [commands, ...(markdown ? f.markdownContentExtensions() : f.contentExtensions({ trailingNode: false }))],
      content,
    });
    const all = (e: any) => e.view.dispatch(e.state.tr.setSelection(new f.AllSelection(e.state.doc)));
    const ids = (e: any) => Array.from(e.view.dom.querySelectorAll("p[id],h1[id],pre[id]"), (el: any) => el.id);
    const source = '<p id="one" dir="rtl" style="text-align: right;">첫째</p><p id="two">Second😀</p><p>Missing</p>';
    const e = create(source), baseline = e.getHTML(); all(e);
    const can = e.can().setHeading({ level: 1 }), canChain = e.can().chain().setHeading({ level: 1 }).setParagraph().run();
    const afterCan = e.getHTML(), canDepth = f.undoDepth(e.state);
    const events: any[] = [];
    e.on("transaction", ({ transaction }: any) => events.push({ changed: transaction.docChanged, tag: transaction.getMeta("format-tag") }));
    e.chain().focus().setHeading({ level: 1 }).setMeta("format-tag", "heading").run();
    const heading = e.getHTML(), headingIds = ids(e), align = e.state.doc.child(0).attrs.textAlign, dir = e.state.doc.child(0).attrs.dir;
    e.commands.undo(); const undo = e.getHTML(); e.commands.redo(); const redo = e.getHTML();
    e.commands.toggleHeading({ level: 1 }); const paragraph = e.getHTML(), paragraphIds = ids(e);
    e.commands.toggleCodeBlock({ language: "typescript" }); const code = e.getHTML(), codeIds = ids(e);
    e.commands.toggleCodeBlock({ language: "typescript" }); const uncode = e.getHTML(), uncodeIds = ids(e);
    e.destroy();
    const noop = create('<h1 id="one">First</h1><h1>Still unedited</h1>'); all(noop);
    const noopBefore = noop.getHTML(), noopCan = noop.can().setHeading({ level: 1 });
    const noopResult = noop.commands.setHeading({ level: 1 }), noopAfter = noop.getHTML(), noopDepth = f.undoDepth(noop.state); noop.destroy();
    const chain = create('<p id="stable">Alpha</p><p>Untouched</p>');
    const chainBefore = chain.getHTML(); chain.commands.setTextSelection(3);
    chain.chain().insertContent("X").setHeading({ level: 2 }).run(); const chainAfter = chain.getHTML();
    chain.commands.undo(); const chainUndo = chain.getHTML(); chain.destroy();
    const md = create('<p>Markdown first</p><p>Markdown second</p>', true); all(md);
    md.commands.setHeading({ level: 6 }); const markdownHeading = md.getHTML(); md.destroy();
    return { baseline, can, canChain, afterCan, canDepth, heading, headingIds, align, dir, undo, redo, paragraph, paragraphIds, code, codeIds, uncode, uncodeIds, events, noopBefore, noopCan, noopResult, noopAfter, noopDepth, chainBefore, chainAfter, chainUndo, markdownHeading };
  });
  assert.equal(results.can, true); assert.equal(results.canChain, true);
  assert.equal(results.afterCan, results.baseline, "can() must not alter the current document");
  assert.equal(results.canDepth, 0, "can() must not add history");
  assert.deepEqual(results.headingIds.slice(0, 2), ["one", "two"], "each formatted heading retains its own ID");
  assert.match(results.headingIds[2], /^ink-block-/); assert.equal(new Set(results.headingIds).size, 3);
  assert.equal(results.align, "right"); assert.equal(results.dir, "rtl");
  assert.equal(results.undo, results.baseline, "one Undo restores the format and its new ID together");
  assert.equal(results.redo, results.heading, "Redo restores the same generated ID");
  assert.deepEqual(results.paragraphIds, results.headingIds, "heading toggle preserves IDs");
  assert.deepEqual(results.codeIds, results.headingIds, "code conversion preserves IDs");
  assert.deepEqual(results.uncodeIds, results.headingIds, "code toggle preserves IDs");
  assert.match(results.code, /<code class="language-typescript">/);
  assert.ok(results.events.some(event => event.changed && event.tag === "heading"), "the caller's transaction metadata survives");
  assert.equal(results.noopCan, true); assert.equal(results.noopResult, true);
  assert.equal(results.noopAfter, results.noopBefore, "a no-op on AllSelection does not generate IDs");
  assert.equal(results.noopDepth, 0);
  assert.equal(results.chainAfter, '<h2 id="stable">AlXpha</h2><p>Untouched</p>', "formatting reads earlier steps in the same chain");
  assert.equal(results.chainUndo, results.chainBefore, "one Undo restores the whole command chain");
  assert.equal(results.markdownHeading, '<h6>Markdown first</h6><h6>Markdown second</h6>', "Markdown heading levels remain available without HTML IDs");
  console.log("PASS mounted block formats: existing IDs and shared attributes, code toggles, no-op AllSelection, can(), transaction metadata, command chains, Undo/Redo and Markdown levels");
} finally { await browser.close(); }
