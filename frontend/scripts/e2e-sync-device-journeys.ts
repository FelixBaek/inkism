// Two real devices on a real relay, driven through the app UI where the user
// acts: named version create/rename/delete, an image attachment, and an
// offline edit conflict. Sync rounds are triggered over RPC (the same
// sync_now the status button calls). Needs INKISM_TEST_PREVIEW,
// INKISM_TEST_ENGINE, INKISM_TEST_RELAY, CHROMIUM_PATH; INKISM_TEST_ASSETS and
// INKISM_SHOTS are optional.
import assert from 'node:assert/strict';
import {spawn, type ChildProcess} from 'node:child_process';
import {mkdtempSync, mkdirSync, rmSync} from 'node:fs';
import {once} from 'node:events';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {chromium, type Page} from 'playwright-core';

const root = path.resolve(import.meta.dirname, '../..');
const shots = process.env.INKISM_SHOTS;
if (shots) mkdirSync(shots, {recursive: true});
const temporary = mkdtempSync(path.join(os.tmpdir(), 'inkism-journeys-'));
const token = 'device-journeys-relay-token-0123456789ab';
const children: ChildProcess[] = [];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function freePort() {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  return port;
}
async function start(binary: string, args: string[], ready: (log: string) => boolean, env: NodeJS.ProcessEnv = {}) {
  const child = spawn(binary, args, {cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env, ...env}});
  children.push(child);
  let log = '';
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('startup timed out\n' + log)), 20000);
    const seen = (data: Buffer) => { log += data; if (ready(log)) { clearTimeout(timer); resolve(); } };
    child.stdout!.on('data', seen);
    child.stderr!.on('data', seen);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`${binary} exited ${code}\n${log}`)); });
  });
}
async function device(name: string) {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const assets = process.env.INKISM_TEST_ASSETS ? ['--assets', process.env.INKISM_TEST_ASSETS] : [];
  await start(process.env.INKISM_TEST_PREVIEW!, ['--listen', `127.0.0.1:${port}`, '--db', path.join(temporary, name + '.db'), '--engine', process.env.INKISM_TEST_ENGINE!, ...assets], log => log.includes(`Development preview: ${url}`));
  const rpc = async (op: string, args: object = {}) => {
    const v = await (await fetch(url + '/api/rpc', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({op, ...args})})).json();
    assert.equal(v.ok, true, op + ': ' + JSON.stringify(v));
    return v.data;
  };
  return {url, rpc};
}
type Device = Awaited<ReturnType<typeof device>>;
async function round(d: Device) {
  await d.rpc('sync_now');
  for (let i = 0; i < 300; i++) {
    await sleep(100);
    const s = await d.rpc('sync_status');
    if (!s.running && i > 2) { assert.equal(s.error, null, JSON.stringify(s)); return s; }
  }
  throw new Error('sync round did not finish');
}
async function both(a: Device, b: Device) { for (let i = 0; i < 2; i++) { await round(a); await round(b); } }
async function open(page: Page, d: Device, id: string) {
  await d.rpc('workspace_set', {ids: [id], active: id, locations: {}});
  await page.goto(d.url);
}
const history = (page: Page) => page.getByRole('dialog', {name: '버전 기록', exact: true});
async function openHistory(page: Page) {
  await page.getByRole('button', {name: '전체 버전 기록 보기', exact: true}).click();
  await history(page).getByLabel('버전 이름', {exact: true}).waitFor();
}

// 1×1 PNG.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox']});
const errors: string[] = [];
try {
  const relayPort = await freePort();
  const relayUrl = `http://127.0.0.1:${relayPort}`;
  await start(process.env.INKISM_TEST_RELAY!, ['--listen', `127.0.0.1:${relayPort}`, '--db', path.join(temporary, 'relay.db')], () => true, {INKISM_RELAY_TOKEN: token});
  for (let i = 0; i < 50; i++) { try { await fetch(relayUrl + '/v1/changes'); break; } catch { await sleep(100); } }
  const a = await device('a');
  const b = await device('b');
  const key = (await a.rpc('sync_keygen')).key;
  for (const d of [a, b]) await d.rpc('sync_config', {server_url: relayUrl, token, key});

  const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
  await context.addInitScript(() => { localStorage.setItem('inkism.lang', 'ko'); localStorage.setItem('inkism.inspector', 'true'); });
  const pa = await context.newPage();
  const pb = await context.newPage();
  for (const p of [pa, pb]) p.on('pageerror', e => errors.push(e.message));

  // ---- Named versions: create on A, rename on A, B sees it; delete on B, A loses it.
  const note = await a.rpc('save', {note: {title: 'Journey note', content: '<p>first body</p>', text: 'first body'}});
  await open(pa, a, note.id);
  await openHistory(pa);
  await history(pa).getByLabel('버전 이름', {exact: true}).fill('Draft one');
  await history(pa).getByRole('button', {name: '현재 버전 보관', exact: true}).click();
  await history(pa).getByRole('button', {name: /보관: Draft one/}).waitFor();
  await history(pa).getByLabel('버전 이름', {exact: true}).fill('Draft final');
  await history(pa).getByRole('button', {name: '버전 이름 변경', exact: true}).click();
  await history(pa).getByRole('button', {name: /보관: Draft final/}).waitFor();
  await both(a, b);
  await open(pb, b, note.id);
  await openHistory(pb);
  await history(pb).getByRole('button', {name: /보관: Draft final/}).click();
  assert.equal(await history(pb).getByRole('button', {name: /보관: Draft one/}).count(), 0, 'old name survived on B');
  if (shots) await history(pb).screenshot({path: path.join(shots, 'journey-rename-on-b.png')});
  const named = (await b.rpc('history', {id: note.id})).find((h: any) => h.label === 'Draft final');
  assert.equal((await b.rpc('history_body', {id: note.id, history_id: named.id})).content, '<p>first body</p>');
  await history(pb).getByRole('button', {name: '선택한 보관 버전 삭제', exact: true}).click();
  for (let i = 0; i < 50 && await history(pb).getByRole('button', {name: /보관: Draft final/}).count(); i++) await sleep(100);
  assert.equal(await history(pb).getByRole('button', {name: /보관: Draft final/}).count(), 0, 'delete did not apply on B');
  await both(b, a);
  await open(pa, a, note.id);
  await openHistory(pa);
  assert.equal(await history(pa).getByRole('button', {name: /보관: Draft/}).count(), 0, 'delete did not reach A');
  assert.equal((await a.rpc('history', {id: note.id})).filter((h: any) => h.label).length, 0);

  // ---- Attachment: uploaded on A, the image renders on B with the same bytes.
  const form = new FormData();
  form.append('file', new Blob([png], {type: 'image/png'}), 'dot.png');
  form.append('size', String(png.length));
  const uploaded = await (await fetch(a.url + '/api/attachments', {method: 'POST', body: form})).json();
  assert.equal(uploaded.ok, true, JSON.stringify(uploaded));
  const current = await a.rpc('get', {id: note.id});
  await a.rpc('save', {note: {...current, content: `<p>with image</p><p><img src="/api/attachments/${uploaded.data.id}" alt="dot"></p>`, text: 'with image'}});
  await both(a, b);
  const bytes = Buffer.from(await (await fetch(`${b.url}/api/attachments/${uploaded.data.id}`)).arrayBuffer());
  assert.ok(bytes.equals(png), 'attachment bytes differ on B');
  await open(pb, b, note.id);
  const image = pb.locator('img[alt="dot"]').first();
  await image.waitFor();
  await pb.waitForFunction(() => { const i = document.querySelector<HTMLImageElement>('img[alt="dot"]'); return !!i && i.complete && i.naturalWidth === 1; });

  // ---- Offline conflict: both devices edit the same note, nothing is lost.
  const base = await a.rpc('get', {id: note.id});
  await a.rpc('save', {note: {...base, content: '<p>edited on A offline</p>', text: 'edited on A offline'}});
  const baseB = await b.rpc('get', {id: note.id});
  await b.rpc('save', {note: {...baseB, content: '<p>edited on B offline</p>', text: 'edited on B offline'}});
  await both(a, b);
  await both(a, b);
  for (const d of [a, b]) {
    const items = (await d.rpc('list', {view: 'all'})).items;
    const bodies = await Promise.all(items.map((n: any) => d.rpc('get', {id: n.id}).then((x: any) => x.content)));
    assert.ok(bodies.includes('<p>edited on A offline</p>') && bodies.includes('<p>edited on B offline</p>'), 'an offline edit was lost: ' + JSON.stringify(bodies));
    assert.ok(items.some((n: any) => n.title.includes('(충돌 사본)')), 'no conflict copy');
  }
  const listA = (await a.rpc('list', {view: 'all'})).items.map((n: any) => n.id + n.title).sort();
  const listB = (await b.rpc('list', {view: 'all'})).items.map((n: any) => n.id + n.title).sort();
  assert.deepEqual(listA, listB, 'devices did not converge');
  await pb.goto(b.url);
  await pb.getByText('Journey note (충돌 사본)').first().waitFor();
  if (shots) await pb.screenshot({path: path.join(shots, 'journey-conflict-copy-on-b.png')});
  assert.deepEqual(errors, []);
  console.log('PASS device journeys: named version create/rename (A→B) and delete (B→A) through the history UI, image attachment bytes + render on B, offline edit conflict keeps both bodies and converges');
} finally {
  await browser.close();
  for (const child of children) child.kill();
  await sleep(300);
  rmSync(temporary, {recursive: true, force: true});
}
