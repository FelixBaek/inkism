import assert from "node:assert/strict";
import { build } from "esbuild";

const bundle = await build({ stdin: { contents: "export * from './lib/plugins';", resolveDir: new URL("../src/", import.meta.url).pathname, loader: "ts" }, bundle: true, write: false, format: "cjs", platform: "node", logLevel: "error" });
const module = { exports: {} as Record<string, unknown> };
new Function("module", "exports", bundle.outputFiles[0].text)(module, module.exports);
const validatePlugin = module.exports.validatePlugin as (input: unknown) => { id: string };
assert.equal(validatePlugin({ id: "demo.colors", version: "1.0.0", name: "Demo", fonts: [{ id: "demo", label: "Demo", family: "Demo", url: "/fonts/demo.woff2" }], colors: [{ id: "red", label: "Red", value: "#ff0000" }] }).id, "demo.colors");
assert.throws(() => validatePlugin({ id: "demo", version: "1.0.0", name: "Demo", entry: "evil.js" }), /실행 코드/);
assert.throws(() => validatePlugin({ id: "demo", version: "1.0.0", name: "Demo", fonts: [{ id: "remote-font", label: "Remote", family: "Remote", url: "https://example.com/x.woff2" }] }), /폰트/);
assert.throws(() => validatePlugin({ id: "demo", version: "bad", name: "Demo" }), /버전/);

for (const url of ["/fonts/../../private.woff2", "//evil.example/font.woff2", "/api/attachments/not-an-id", "/fonts/font.html"]) {
  assert.throws(() => validatePlugin({ id: "demo.local", version: "1.0.0", name: "Local", fonts: [{ id: "local-font", label: "Local", family: "Local", url }] }), /폰트/);
}
assert.throws(() => validatePlugin({ id: "inkism.bundled-editor", version: "1.0.0", name: "Forged" }), /ID/);
assert.throws(() => validatePlugin({ id: "demo.duplicate", version: "1.0.0", name: "Duplicate", colors: [{id:"same",label:"A",value:"#112233"},{id:"same",label:"B",value:"#445566"}] }), /중복/);
console.log("PASS plugin manifest validation: declarative resources, executable and remote resource rejection");
