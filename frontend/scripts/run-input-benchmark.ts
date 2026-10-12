// Reproducible input benchmark. Each workload uses a disposable SQLite library.
// Run after building frontend/dist and the release local-api/runtime binaries.
// Workloads run sequentially to avoid contaminating one another’s timings.
import {spawn, spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {once} from 'node:events';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
const tests=['idle','index-load'];
const forbiddenPorts = new Set([47831, 47851, 47861, 47871, 47881]);
async function freePort() {
  for (;;) {
    const socket = net.createServer();
    socket.listen(0, '127.0.0.1');
    await once(socket, 'listening');
    const port = (socket.address() as net.AddressInfo).port;
    await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
    if (!forbiddenPorts.has(port)) return port;
  }
}
let failures = 0;
for (const test of tests) {
  console.log('\nINPUT BENCHMARK: '+test);
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'inkism-browser-'));
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const preview = process.env.INKISM_TEST_PREVIEW || path.join(root, 'core/local-api/target/release/inkism-local-api' + suffix);
  const engine = process.env.INKISM_TEST_ENGINE || path.join(root, 'core/runtime-core/target/release/inkism-engine' + suffix);
  const server = spawn(preview, ['--listen', `127.0.0.1:${port}`, '--db', path.join(temporary, 'notes.db'), '--engine', engine, '--assets', process.env.INKISM_TEST_ASSETS || path.join(root, 'frontend/dist')], {cwd: root, stdio: ['ignore', 'ignore', 'pipe']});
  let serverLog = '';
  server.stderr.on('data', data => { serverLog += data; });
  const stopped = new Promise<void>(resolve => { server.once('close', () => resolve()); });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('preview startup timed out')), 15000);
      server.once('error', error => { clearTimeout(timer); reject(error); });
      server.once('exit', code => { clearTimeout(timer); reject(new Error(`preview exited: ${code}\n${serverLog}`)); });
      server.stderr.on('data', () => {
        if (serverLog.includes(`Development preview: ${url}`)) { clearTimeout(timer); resolve(); }
      });
    });
    const result = spawnSync(process.execPath, [path.join(import.meta.dirname, 'bench-windowed-input.ts')], {stdio:'inherit', env:{...process.env, INKISM_URL:url, INKISM_BENCH_DEFAULT:"1", INKISM_ENGINE_PROFILE:process.env.INKISM_ENGINE_PROFILE||"release", INKISM_INDEX_LOAD:test==="index-load"?"1":"0"}, timeout:300000});
    if (result.error) console.error(result.error.message);
    if (result.status !== 0) failures++;
  } catch (error) {
    console.error(error);
    failures++;
  } finally {
    server.kill();
    await stopped;
    rmSync(temporary, {recursive:true, force:true});
  }
}
console.log(`Input benchmark workloads: ${tests.length-failures} passed, ${failures} failed`);
process.exitCode = failures ? 1 : 0;
