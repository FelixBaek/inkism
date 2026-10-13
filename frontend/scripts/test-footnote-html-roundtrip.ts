import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { chromium } from "./browser-env.ts";

const bundle = await build({ stdin: { contents: "export * from './lib/pdf-references';", resolveDir: fileURLToPath(new URL("../src/", import.meta.url)), loader: "ts" }, bundle: true, write: false, format: "iife", globalName: "footnotes", platform: "browser", logLevel: "error" });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage(); await page.goto("about:blank"); await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(() => {
    const f = (window as any).footnotes;
    const eq = (a: any, b: any, label: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw Error(label); };
    const ok = (value: any, label: string) => { if (!value) throw Error(label); };
    const rejects = (run: () => any, label: string) => { try { run(); } catch { return; } throw Error("accepted " + label); };
    const prefix = '\ufeff<p title="&gt;">원문 &amp;😀 <a href="#fn-a">1</a> <a href="#fn-a">1</a> <a href="#fn-b">2</a></p>\r\n';
    const alpha = '<li id="fn-a" value="4"><p><sup>13</sup>C and E=mc<sup>2</sup>; H<sub>2</sub>O.</p><ul><li title="fake </li>">Inner</li></ul><!-- </li> --><a class="footnote-backref" href="#return-a">↩</a></li>';
    const beta = '<li id="fn-b"><p>Beta <em>rich text</em></p><p>Second paragraph</p><a href="#fnref-b">↩</a></li>';
    const suffix = '\r\n<p>외부 &#128512; exact</p>', source = prefix + '<ol>' + alpha + '\r\n' + beta + '</ol>' + suffix;
    const parsed = f.extractFootnotes(source, "html");
    eq(parsed.map((note: any) => note.id), ["a", "b"], "nested ordinary list is one whole definition");
    ok(parsed[0].text.includes("13C and E=mc2; H2O."), "list superscripts/subscripts remain content");
    eq(source.slice(parsed[0].from, parsed[0].to), alpha, "nested list, quoted closing token and comment have exact source bounds");
    eq(f.setFootnote(source, "html", "a", parsed[0].text, true), source, "an unchanged plain-text read preserves the full rich definition");
    const replacement = '<li id="fn-a" value="4">Revised😀<br>second<a class="footnote-backref" href="#return-a">↩</a></li>';
    const edited = f.setFootnote(source, "html", "a", "Revised😀\nsecond", true);
    eq(edited, source.replace(alpha, replacement), "only the whole edited definition changes; original attributes/backlink and outside CRLF/BOM bytes stay exact");
    const template = document.createElement("template"); template.innerHTML = edited;
    eq(template.content.querySelector('a[href="#return-a"]').parentElement.id, "fn-a", "backlink stays inside its definition");
    const deleted = f.removeFootnote(source, "html", "a");
    eq(deleted, source.replace(alpha, "").replaceAll('<a href="#fn-a">1</a>', ""), "delete removes only the selected definition and its repeated references");
    eq(f.extractFootnotes(deleted, "html").map((note: any) => note.id), ["b"], "other definition is unchanged");
    rejects(() => f.reorderHtmlFootnotes(source), "nested same-tag reordering remains explicitly unsupported");

    const ordinary = prefix + '<ol>' + beta + '\r\n<li id="fn-a" value="7"><p>E=mc<sup>2</sup></p></li></ol>' + suffix;
    const numbered = f.renumberHtmlFootnotes(ordinary), arranged = f.reorderHtmlFootnotes(numbered);
    ok(numbered.includes('<li id="fn-a" value="1"><p>E=mc<sup>2</sup></p>'), "renumber leaves scientific superscripts intact");
    ok(arranged.indexOf('id="fn-a"') < arranged.indexOf('id="fn-b"'), "same-tag sibling definitions reorder");
    ok(numbered.startsWith(prefix) && numbered.endsWith(suffix), "numbering preserves outside raw bytes");
    const paragraph = '<p><a href="#fn-z">z</a></p><p id="fn-z"><sup>z</sup> Text E=mc<sup>2</sup>.</p>';
    eq(f.extractFootnotes(paragraph, "html")[0].text, "Text E=mc2.", "only the app paragraph label is removed");
    const paragraphNumbered = f.renumberHtmlFootnotes(paragraph);
    eq(f.extractFootnotes(paragraphNumbered, "html")[0].text, "Text E=mc2.", "renumbered paragraph label matches its real reference");
    const scienceStart = '<p><a href="#fn-x">1</a></p><p id="fn-x"><sup>13</sup>C scientific content</p>';
    eq(f.extractFootnotes(scienceStart, "html")[0].text, "13C scientific content", "a leading scientific superscript is not the reference label");
    rejects(() => f.renumberHtmlFootnotes(scienceStart), "renumbering an unlabelled scientific paragraph refuses source loss");
    const overlapping = '<ol><li id="fn-a"><ol><li id="fn-b">Nested definition</li></ol></li></ol>';
    rejects(() => f.setFootnote(overlapping, "html", "a", "Changed", true), "overlapping definitions cannot be overwritten");
    rejects(() => f.removeFootnote(overlapping, "html", "b"), "overlapping definitions cannot be deleted");
    const fakeAttributes = '<p title=" id=\'fn-x\'">ordinary</p><a title=" href=\'#fn-x\'" href="#else">ordinary link</a><p id="fn-x"><sup>x</sup> Footnote</p>';
    eq(f.extractFootnotes(fakeAttributes, "html").map((note: any) => note.text), ["Footnote"], "quoted id text is not an attribute");
    eq(f.removeFootnote(fakeAttributes, "html", "x"), fakeAttributes.replace('<p id="fn-x"><sup>x</sup> Footnote</p>', ''), "quoted href text cannot delete an unrelated link");
    const fakeValue = '<p><a href="#fn-x">x</a></p><ol><li title=" value=\'7\'" id="fn-x">Body</li></ol>';
    eq(f.renumberHtmlFootnotes(fakeValue), '<p><a href="#fn-x">1</a></p><ol><li title=" value=\'7\'" id="fn-x" value="1">Body</li></ol>', "numbering changes only a real value attribute");
    const nestedAnchors = '<p>prefix <a href="#fn-x">one<a href="#fn-x">two</a>three</a> tail exact</p><p id="fn-x"><sup>x</sup> Footnote</p>';
    rejects(() => f.removeFootnote(nestedAnchors, "html", "x"), "overlapping reference deletions cannot truncate outside source");
    const differentNestedAnchors = '<p>prefix <a href="#fn-x">one<a href="#fn-y">two</a>three</a> tail exact</p><p id="fn-x"><sup>x</sup> Footnote</p>';
    rejects(() => f.removeFootnote(differentNestedAnchors, "html", "x"), "a nested anchor to another ID cannot be removed as part of an outer reference");
    const nestedParagraph = '<p id="fn-x">First<p>Second</p>tail</p>';
    rejects(() => f.setFootnote(nestedParagraph, "html", "x", "Changed", true), "a nested paragraph has ambiguous HTML definition bounds");
    rejects(() => f.setFootnote(nestedParagraph, "html", "x", "Added"), "an unrecognized malformed definition still owns its DOM ID");
    const ghostBacklink = '<p id="fn-x"><sup>x</sup>Before<!--<a href="#fnref-x">ghost</a>--><script>const link=\'<a href="#fnref-x">raw ghost</a>\';</script><a href="#fnref-x">real</a></p><p>tail exact</p>';
    eq(f.setFootnote(ghostBacklink, "html", "x", "After", true), '<p id="fn-x"><sup>x</sup>After<a href="#fnref-x">real</a></p><p>tail exact</p>', "editing preserves actual backlinks without activating comment/raw text anchors");
    const refNamed = '<p><sup id="fnref-x"><a href="#fn-x">x</a></sup> <a href="#fn-ref-x">ref-x</a></p><p id="fn-x"><sup>x</sup>First <a href="#fnref-x">back</a></p><p id="fn-ref-x"><sup>ref-x</sup>Second</p>';
    eq(f.removeFootnote(refNamed, "html", "ref-x"), refNamed.replace('<a href="#fn-ref-x">ref-x</a>', '').replace('<p id="fn-ref-x"><sup>ref-x</sup>Second</p>', ''), "fnref backlinks are never confused with a definition named ref-x");
    rejects(() => f.setFootnote('<p id="fn-x" id="other">Original definition</p>', "html", "x", "New"), "ambiguous duplicate attributes cannot create a duplicate DOM definition ID");

    const malformed = [
      '<li id="fn-a">Alpha<!-- unclosed </li>',
      '<li id="fn-a">Alpha<script>const fake="</li>";',
      '<li id="fn-a">Alpha<code>unclosed </li>',
      '<!-- unclosed <p id="fn-a">fake</p>',
      '<script>unclosed <p id="fn-a">fake</p>',
      '<script type="unfinished',
      '<script type="unfinished <p id=\'fn-a\'>fake</p>',
      '<a href="#fn-a" title="unfinished </a><p id=\'fn-a\'>fake</p>',
    ];
    for (const bad of malformed) {
      eq(f.extractFootnotes(bad, "html"), [], "unfinished raw/comment markup cannot supply a phantom definition");
      rejects(() => f.setFootnote(bad, "html", "a", "Changed", true), "malformed definition edit");
      rejects(() => f.removeFootnote(bad, "html", "a"), "malformed definition deletion");
      rejects(() => f.setFootnote(bad, "html", "new", "Added"), "append inside unfinished raw/comment content");
      eq(f.renumberHtmlFootnotes(bad), bad, "unrecognized malformed structure stays exact");
    }
    const deep = '<li id="fn-a">' + '<li>'.repeat(129) + 'deep' + '</li>'.repeat(130);
    rejects(() => f.setFootnote(deep, "html", "a", "Changed", true), "excessive nesting");
    rejects(() => f.setFootnote(source, "html", "a", "x".repeat(10001), true), "oversized edit content");
    const large = 'before'.repeat(200000) + paragraph + 'after'.repeat(200000);
    eq(f.setFootnote(large, "html", "z", "New text", true), large.replace('<p id="fn-z"><sup>z</sup> Text E=mc<sup>2</sup>.</p>', '<p id="fn-z"><sup>z</sup>New text</p>'), "large surrounding source is not normalized");
    const markdown = 'Refs [^a] [^a] [^b] `[^a]` \\[^a]\r\n\r\n[^a]: Alpha\r\n    second\r\n\r\n[^b]: Beta\r\n';
    eq(f.removeFootnote(markdown, "markdown", "a"), 'Refs   [^b] `[^a]` \\[^a]\r\n\r\n\r\n\r\n[^b]: Beta\r\n', "Markdown deletion preserves escaped/code references and exact separators");
    return { definitions: parsed.length, malformed: malformed.length, largeBytes: new TextEncoder().encode(large).length };
  });
  assert.equal(result.definitions, 2); assert.equal(result.malformed, 8); assert.ok(result.largeBytes > 2 * 1024 * 1024);
  console.log("PASS HTML footnotes: scientific superscripts, exact nested boundaries, backlinks/CRLF/BOM, metadata-only renumbering, deletion, malformed/deep/oversized refusal and large raw source preservation", JSON.stringify(result));
} finally { await browser.close(); }
