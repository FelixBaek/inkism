// Two real devices on a real relay: notes held for the vault key (DEV-01) and
// versions kept sealed under a plain note (DEV-02), in ko/en/ja/zh.
// Needs INKISM_TEST_PREVIEW, INKISM_TEST_ENGINE, INKISM_TEST_RELAY, CHROMIUM_PATH;
// INKISM_TEST_ASSETS (built frontend) and INKISM_SHOTS (screenshot folder) are optional.
import assert from 'node:assert/strict';
import {spawn, type ChildProcess} from 'node:child_process';
import {mkdtempSync, mkdirSync, rmSync} from 'node:fs';
import {once} from 'node:events';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {chromium, type Page} from 'playwright-core';

const root = path.resolve(import.meta.dirname, '../..');
const shots = process.env.INKISM_SHOTS;
if (shots) mkdirSync(shots, {recursive: true});
const temporary = mkdtempSync(path.join(os.tmpdir(), 'inkism-sync-held-'));
const token = 'held-notices-relay-token-0123456789abcdef';
const children: ChildProcess[] = [];

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
async function preview(name: string) {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const db = path.join(temporary, name + '.db');
  const assets = process.env.INKISM_TEST_ASSETS ? ['--assets', process.env.INKISM_TEST_ASSETS] : [];
  await start(process.env.INKISM_TEST_PREVIEW!, ['--listen', `127.0.0.1:${port}`, '--db', db, '--engine', process.env.INKISM_TEST_ENGINE!, ...assets], log => log.includes(`Development preview: ${url}`));
  const rpc = async (op: string, args: object = {}) => {
    const v = await (await fetch(url + '/api/rpc', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({op, ...args})})).json();
    assert.equal(v.ok, true, op + ': ' + JSON.stringify(v));
    return v.data;
  };
  return {url, db, rpc};
}
type Device = Awaited<ReturnType<typeof preview>>;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function round(d: Device) {
  await d.rpc('sync_now');
  for (let i = 0; i < 300; i++) {
    await sleep(100);
    const s = await d.rpc('sync_status');
    if (!s.running && i > 2) return s;
  }
  throw new Error('sync round did not finish');
}
const revision = async (d: Device, id: string) => (await d.rpc('list', {view: 'all'})).items.find((n: any) => n.id === id).revision;

const LANGS = {
  ko: {held: '금고 열기를 기다리는 노트 1개', openVault: '금고 열기', sealed: '암호화된 채로 보관된 버전 1개', vaultSettings: '금고 설정 열기', indicator: '금고 열기 대기 1개'},
  en: {held: 'Notes waiting for the vault: 1', openVault: 'Open vault', sealed: 'Versions kept encrypted: 1', vaultSettings: 'Open vault settings', indicator: 'Waiting for vault: 1'},
  ja: {held: '金庫を開くのを待っているノート 1 件', openVault: '金庫を開く', sealed: '暗号化されたまま保管されたバージョン 1 件', vaultSettings: '金庫の設定を開く', indicator: '金庫待ち 1 件'},
  zh: {held: '1 篇笔记等待打开保险库', openVault: '打开保险库', sealed: '1 个以加密形式保留的版本', vaultSettings: '打开保险库设置', indicator: '1 项等待保险库'},
} as const;
type Lang = keyof typeof LANGS;

async function openSync(page: Page, lang: Lang) {
  // The settings dialog listens only once the app shell has mounted.
  await page.locator('.status-connection').first().waitFor();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('inkism-open-settings', {detail: 'sync'})));
  const label = {ko: '기기 동기화', en: 'Device sync', ja: 'デバイス同期', zh: '设备同步'}[lang];
  await page.locator('button.side-item', {hasText: label}).last().click();
}

const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox']});
const errors: string[] = [];
try {
  const relayPort = await freePort();
  const relayUrl = `http://127.0.0.1:${relayPort}`;
  await start(process.env.INKISM_TEST_RELAY!, ['--listen', `127.0.0.1:${relayPort}`, '--db', path.join(temporary, 'relay.db')], () => true, {INKISM_RELAY_TOKEN: token});
  for (let i = 0; i < 50; i++) { try { await fetch(relayUrl + '/v1/changes'); break; } catch { await sleep(100); } }
  const a = await preview('a');
  const b = await preview('b');
  const key = (await a.rpc('sync_keygen')).key;
  const config = (d: Device) => d.rpc('sync_config', {server_url: relayUrl, token, key});

  // ---- DEV-01: B names a version offline while A (keyless) locks the note.
  const held = await a.rpc('save', {note: {title: 'Held note', content: '<p>HELD-SECRET</p>', text: 'HELD-SECRET'}});
  await a.rpc('vault_create', {password: 'held-password'});
  await config(a); await round(a);
  await config(b); await round(b);
  await b.rpc('history_name_current', {id: held.id, revision: await revision(b, held.id), label: 'B offline'});
  await a.rpc('vault_lock_note', {id: held.id, revision: await revision(a, held.id)});
  await a.rpc('vault_lock');
  let sb: any;
  for (let i = 0; i < 3; i++) { await round(a); sb = await round(b); }
  assert.equal(sb.error, null, JSON.stringify(sb));
  assert.deepEqual(sb.vault_key_required, [held.id], JSON.stringify(sb));
  // Other notes keep syncing in both directions while the note waits.
  const other = await a.rpc('save', {note: {title: 'Other note', content: '<p>keeps syncing</p>', text: 'keeps syncing'}});
  await round(a); sb = await round(b);
  assert.equal((await b.rpc('get', {id: other.id})).content, '<p>keeps syncing</p>');
  const fromB = await b.rpc('save', {note: {title: 'From B', content: '<p>b to a</p>', text: 'b to a'}});
  await round(b); await round(a);
  assert.equal((await a.rpc('get', {id: fromB.id})).content, '<p>b to a</p>');
  assert.deepEqual((await b.rpc('sync_status')).vault_key_required, [held.id]);

  const page = await browser.newPage({viewport: {width: 1280, height: 900}});
  page.on('pageerror', e => errors.push(e.message));
  for (const lang of Object.keys(LANGS) as Lang[]) {
    await page.addInitScript(l => localStorage.setItem('inkism.lang', l), lang);
    await page.goto(b.url);
    await page.getByText(LANGS[lang].indicator).first().waitFor();
    await openSync(page, lang);
    const notice = page.locator('.sync-held');
    await notice.getByText(LANGS[lang].held).waitFor();
    await notice.getByText('Held note').waitFor();
    if (shots) await page.locator('.sync-dialog').screenshot({path: path.join(shots, `dev01-vault-wait-${lang}.png`)});
  }
  // The unlock entry point leads to the vault settings; unlocking applies the wait.
  await page.addInitScript(() => localStorage.setItem('inkism.lang', 'ko'));
  await page.goto(b.url);
  await openSync(page, 'ko');
  await page.locator('.sync-held').getByRole('button', {name: '금고 열기', exact: true}).click();
  await page.locator('.sync-dialog').waitFor({state: 'hidden'});
  const password = page.getByLabel('금고 비밀번호', {exact: true});
  await password.fill('held-password');
  await page.getByRole('button', {name: '금고 열기', exact: true}).click();
  await page.getByText('금고 열림', {exact: true}).waitFor();
  for (let i = 0; i < 3; i++) { sb = await round(b); await round(a); }
  assert.deepEqual(sb.vault_key_required, [], JSON.stringify(sb));
  for (const d of [a, b]) {
    const item = (await d.rpc('list', {view: 'all'})).items.find((n: any) => n.id === held.id);
    assert.equal(item.locked, true);
    assert.deepEqual(await d.rpc('history', {id: held.id}), [], 'plaintext history under the locked note');
    const raw = new DatabaseSync(d.db, {readOnly: true}).prepare('SELECT group_concat(data) AS d FROM encrypted_named_versions WHERE note_id=?').get(held.id) as {d: string};
    assert.ok(raw.d.includes('B offline') && !raw.d.includes('HELD-SECRET'), raw.d);
  }
  await page.evaluate(() => window.dispatchEvent(new Event('inkism-open-settings')));
  await openSync(page, 'ko');
  await page.getByRole('region', {name: '동기화 상태', exact: true}).waitFor();
  assert.equal(await page.locator('.sync-held').count(), 0, 'wait notice still shown after unlock');
  if (shots) await page.locator('.sync-dialog').screenshot({path: path.join(shots, 'dev01-after-unlock-ko.png')});

  // ---- DEV-02: a sealed version left under a note that is no longer locked.
  const c = await preview('c');
  const plain = await c.rpc('save', {note: {title: 'Sealed history', content: '<p>SEALED-ORIGINAL</p>', text: 'SEALED-ORIGINAL'}});
  await c.rpc('history_name_current', {id: plain.id, revision: plain.revision, label: 'Before move'});
  await c.rpc('vault_create', {password: 'sealed-password'});
  await c.rpc('vault_lock_note', {id: plain.id, revision: await revision(c, plain.id)});
  const sqlite = new DatabaseSync(c.db);
  const row = sqlite.prepare('SELECT id,data FROM encrypted_named_versions WHERE note_id=?').get(plain.id) as {id: string; data: string};
  await c.rpc('vault_unlock_note', {id: plain.id, revision: await revision(c, plain.id)});
  sqlite.prepare('DELETE FROM history WHERE id=?').run(row.id);
  sqlite.prepare('INSERT INTO encrypted_named_versions(id,note_id,data) VALUES(?,?,?)').run(row.id, plain.id, row.data);
  sqlite.close();
  await c.rpc('vault_lock');
  await c.rpc('workspace_set', {ids: [plain.id], active: plain.id, locations: {}});
  const historyDialog = page.locator('dialog[open]').filter({has: page.locator('.history-sealed')});
  for (const lang of Object.keys(LANGS) as Lang[]) {
    await page.addInitScript(l => { localStorage.setItem('inkism.lang', l); localStorage.setItem('inkism.inspector', 'true'); }, lang);
    await page.goto(c.url);
    const label = {ko: '전체 버전 기록 보기', en: 'View full version history', ja: 'すべてのバージョン履歴を表示', zh: '查看完整版本历史'}[lang];
    await page.getByRole('button', {name: label, exact: true}).click();
    const sealed = page.locator('.history-sealed');
    await sealed.getByText(LANGS[lang].sealed).waitFor();
    const text = await page.locator('dialog[open]').innerText();
    assert.ok(!text.includes('SEALED-ORIGINAL'), 'plaintext shown in the history');
    assert.ok(text.includes('Before move'));
    if (shots) await historyDialog.screenshot({path: path.join(shots, `dev02-sealed-history-${lang}.png`)});
    await page.keyboard.press('Escape');
  }
  await page.addInitScript(() => localStorage.setItem('inkism.lang', 'ko'));
  await page.goto(c.url);
  await page.getByRole('button', {name: '전체 버전 기록 보기', exact: true}).click();
  await page.locator('.history-sealed').getByRole('button', {name: '금고 설정 열기', exact: true}).click();
  await page.getByLabel('금고 비밀번호', {exact: true}).waitFor();
  // The explained recovery: unlock vault, move into vault, take back out.
  await c.rpc('vault_unlock', {password: 'sealed-password'});
  await c.rpc('vault_lock_note', {id: plain.id, revision: await revision(c, plain.id)});
  await c.rpc('vault_unlock_note', {id: plain.id, revision: await revision(c, plain.id)});
  assert.deepEqual(await c.rpc('history_sealed', {id: plain.id}), []);
  assert.equal((await c.rpc('history_body', {id: plain.id, history_id: row.id})).content, '<p>SEALED-ORIGINAL</p>');
  await page.goto(c.url);
  await page.getByRole('button', {name: '전체 버전 기록 보기', exact: true}).click();
  await page.getByRole('button', {name: /보관: Before move/}).waitFor();
  assert.equal(await page.locator('.history-sealed').count(), 0);
  // ---- DEV-03 notice: the runtime reports held newer-app records (covered
  // against the real relay in runtime-core named_version_sync); here only the
  // status payload is injected to check the copy and the update entry point.
  await page.route('**/api/rpc', async route => {
    if (route.request().postDataJSON()?.op !== 'sync_status') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    body.data.unsupported_records = 2;
    return route.fulfill({response, json: body});
  });
  const NEWER = {ko: ['새 버전 앱에서 만든 변경 2개 보관 중', '업데이트 확인'], en: ['Holding changes from a newer app: 2', 'Check for updates'], ja: ['新しいアプリで作られた変更 2 件を保持中', 'アップデートを確認'], zh: ['正在保留 2 项来自较新版本应用的更改', '检查更新']} as const;
  for (const lang of Object.keys(LANGS) as Lang[]) {
    await page.addInitScript(l => localStorage.setItem('inkism.lang', l), lang);
    await page.goto(b.url);
    await openSync(page, lang);
    const notice = page.locator('.sync-held').filter({hasText: NEWER[lang][0]});
    await notice.waitFor();
    if (shots) await notice.screenshot({path: path.join(shots, `dev03-newer-records-${lang}.png`)});
    if (lang === 'ko') {
      await notice.getByRole('button', {name: NEWER[lang][1], exact: true}).click();
      await page.locator('.sync-dialog').waitFor({state: 'hidden'});
      await page.getByRole('region', {name: '정보', exact: true}).waitFor();
    }
  }
  await page.unroute('**/api/rpc');
  assert.deepEqual(errors, []);
  console.log('PASS sync held notices: vault wait (2 devices, ko/en/ja/zh), unlock clears it, other notes keep syncing; sealed history (ko/en/ja/zh), no plaintext, recovery restores it');
} finally {
  await browser.close();
  for (const child of children) child.kill();
  await sleep(300);
  rmSync(temporary, {recursive: true, force: true});
}
