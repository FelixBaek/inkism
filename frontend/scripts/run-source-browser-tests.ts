// Each gate gets a fresh Rust preview and synthetic library; no shared server state.
import {spawn, spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {once} from 'node:events';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
const tests=['figma-parity','selection-tag-input','rich-modes','window-edge-input','restart-rich-history','rich-compat','source-first','format-race','inspector','inspector-split','preview-export','markdown-export','editor-settings','plugins','knowledge','document-tools','table-quality','mermaid-tools','model-loading','media-recovery','waveform-budget','collection-management','block-links','writing-tools','type-presets','merge-preview','html-outline','markdown-outline','workspace-tools','note-preview','mobile-dialogs','backlink-context','backlinks-paged','connections-paged','reference-bounded','canvas-attachments','canvas-groups','whiteboard','math-diagnostics','global-search-navigation','search-presets','task-overview','similar-notes','quick-capture','capture-workflow','global-search-paged','note-answer','wiki-update','semantic-answer','semantic-space','ai-settings','ai-cancel','discovery-commands','command-history','footnote-navigation','term-definition','presentation','presentation-export','settings-resources','executable-plugin','portable-library','backup-stream','portable-sync','portable-sync-ui','sync-held-previews','security-boundary','custom-theme','tabs-layout','tabs-dnd','reminders','reminder-actions','encrypted-copy-ui','encrypted-versions','named-versions','named-restore-race','metadata','tags','tags-preview','notebook-delete','source-attachments','source-pane-focus','split','split-search','restart-history','history-errors','google-security-ui','agent-api-settings','typed-relations'];
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
  console.log('\nEDITOR BROWSER GATE: '+test);
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'inkism-browser-'));
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const preview = process.env.INKISM_TEST_PREVIEW || path.join(root, 'core/local-api/target/release/inkism-local-api' + suffix);
  const engine = process.env.INKISM_TEST_ENGINE || path.join(root, 'core/runtime-core/target/release/inkism-engine' + suffix);
  // INKISM_TEST_ASSETS: a fresh frontend build to serve instead of frontend/dist.
  const assets = process.env.INKISM_TEST_ASSETS ? ['--assets', process.env.INKISM_TEST_ASSETS] : [];
  const server = spawn(preview, ['--listen', `127.0.0.1:${port}`, '--db', path.join(temporary, 'notes.db'), '--engine', engine, ...assets], {cwd: root, stdio: ['ignore', 'ignore', 'pipe']});
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
    const result = spawnSync(process.execPath, [path.join(import.meta.dirname, 'e2e-'+test+'.ts')], {stdio:'inherit', env:{...process.env, INKISM_URL:url}, timeout:180000});
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
console.log(`Browser gates: ${tests.length-failures} passed, ${failures} failed`);
process.exitCode = failures ? 1 : 0;
