import { strict as assert } from "node:assert";
import { mkdtemp, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
const dir = await mkdtemp(join(tmpdir(), "inkism-cli-"));
const fake = join(dir, "fake-engine.mjs");
await writeFile(fake, `#!/usr/bin/env node\nprocess.stdin.on('data', d => { const r=JSON.parse(String(d)); process.stdout.write(JSON.stringify({ok:true,data:r})+'\\n'); });`);
await chmod(fake, 0o755);
const run = (args) => new Promise((resolve, reject) => {
  const p=spawn(process.execPath,[join(process.cwd(),"tools/inkism-cli.mjs"),"--db","/tmp/fixture.db","--engine",fake,...args],{cwd:process.cwd()});
  let out="", err=""; p.stdout.on("data",d=>out+=d); p.stderr.on("data",d=>err+=d); p.on("close",code=>code?reject(new Error(err)):resolve(JSON.parse(out)));
});
assert.deepEqual((await run(["sync","now"])).data, {op:"sync_now"});
assert.deepEqual((await run(["list","--view","trash"])).data, {op:"list",view:"trash",limit:100});
assert.deepEqual((await run(["get","abc"])).data, {op:"get",id:"abc"});
console.log("inkism-cli: 3 passed");
