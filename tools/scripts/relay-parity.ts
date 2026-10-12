// Black-box parity transcript for the encrypted sync relay binary (Go or Rust).
//
//   node tools/scripts/relay-parity.ts --bin <relay> [--phase full|read] [--db <file>]
//
// full: fresh DB (or --db, which must not exist yet), every write/read/error
//       case plus CLI checks. read: only the read-side requests against an
//       existing --db (used after migrating a bbolt DB into SQLite).
// The transcript goes to stdout; diff two runs to prove wire parity.
// Needs Node 22+ and the openssl CLI (fake Google TLS certificate only).
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn, execFileSync} from 'node:child_process';

const args = process.argv.slice(2);
const opt = (name: string, def = '') => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const bin = path.resolve(opt('bin'));
const phase = opt('phase', 'full');
if (!opt('bin') || !['full', 'read'].includes(phase)) { console.error('usage: relay-parity.ts --bin <relay> [--phase full|read] [--db <file>]'); process.exit(2); }
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-parity-'));
const db = opt('db') ? path.resolve(opt('db')) : path.join(work, 'relay.db');
if (phase === 'full' && fs.existsSync(db)) { console.error('full phase needs a new --db'); process.exit(2); }
if (phase === 'read' && !fs.existsSync(db)) { console.error('read phase needs an existing --db'); process.exit(2); }

// Fixed secrets so a DB written in one run can be read by another.
const TOKEN = 'parity-relay-token-0123456789abcdef';
const CLIENT = '123456-parity.apps.googleusercontent.com';
const SUBJECT = 'parity-subject';
const MASTER = Buffer.alloc(32, 7).toString('base64');
const VAULT = Buffer.alloc(32, 9).toString('base64');
const OTHER_VAULT = Buffer.alloc(32, 10).toString('base64');
const MAX_BLOB = 32 << 20;
const MAX_CHUNK = (256 << 10) + 40;

// ---- fake Google: an HTTPS_PROXY that terminates CONNECT www.googleapis.com:443 with a test CA.
function makeCerts() {
  const run = (...a: string[]) => execFileSync('openssl', a, {cwd: work, stdio: 'pipe'});
  run('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=relay parity CA');
  run('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'leaf.key', '-out', 'leaf.csr', '-subj', '/CN=www.googleapis.com');
  fs.writeFileSync(path.join(work, 'leaf.ext'), 'subjectAltName=DNS:www.googleapis.com,DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n');
  run('x509', '-req', '-in', 'leaf.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'leaf.pem', '-days', '2', '-extfile', 'leaf.ext');
}
makeCerts();
const leaf = {key: fs.readFileSync(path.join(work, 'leaf.key')), cert: fs.readFileSync(path.join(work, 'leaf.pem'))};
const google = crypto.generateKeyPairSync('rsa', {modulusLength: 2048});
const forged = crypto.generateKeyPairSync('rsa', {modulusLength: 2048});
let jwksMode = 'ok';
const jwk = google.publicKey.export({format: 'jwk'}) as {n: string; e: string};
const fake = http.createServer((q, s) => {
  if (q.url !== '/oauth2/v3/certs' || jwksMode === 'fail') { s.writeHead(500); s.end('{}'); return; }
  const key = {kid: 'parity', alg: 'RS256', kty: 'RSA', use: 'sig', n: jwk.n, e: jwk.e};
  s.writeHead(200, {'content-type': 'application/json'});
  s.end(JSON.stringify({keys: jwksMode === 'dup' ? [key, key] : [key]}));
});
const proxy = http.createServer((_q, s) => { s.writeHead(403); s.end(); });
proxy.on('connect', (q, sock: net.Socket) => {
  if (q.url !== 'www.googleapis.com:443') { sock.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
  sock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
  fake.emit('connection', new tls.TLSSocket(sock, {isServer: true, ...leaf, ALPNProtocols: ['http/1.1']}));
});
await new Promise<void>(r => proxy.listen(0, '127.0.0.1', r));
const proxyURL = `http://127.0.0.1:${(proxy.address() as net.AddressInfo).port}`;

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
function idToken(mutate?: (c: any, h: any) => void, key = google.privateKey, raw?: string) {
  const now = Math.floor(Date.now() / 1000);
  const h: any = {alg: 'RS256', kid: 'parity'};
  const c: any = {iss: 'https://accounts.google.com', sub: SUBJECT, aud: CLIENT, iat: now, exp: now + 3600};
  mutate?.(c, h);
  const body = b64u(JSON.stringify(h)) + '.' + b64u(raw ?? JSON.stringify(c));
  return body + '.' + b64u(crypto.sign('sha256', Buffer.from(body), key));
}

// ---- relay process control
const baseEnv = (extra: Record<string, string> = {}) => ({PATH: process.env.PATH ?? '', HTTPS_PROXY: proxyURL, SSL_CERT_FILE: path.join(work, 'ca.pem'), ...extra});
const recoveryEnv = {INKISM_RELAY_TOKEN: TOKEN, INKISM_RECOVERY_GOOGLE_CLIENT_ID: CLIENT, INKISM_RECOVERY_GOOGLE_SUBJECT: SUBJECT, INKISM_RECOVERY_MASTER_KEY: MASTER};
async function freePort() {
  const s = net.createServer();
  await new Promise<void>(r => s.listen(0, '127.0.0.1', r));
  const p = (s.address() as net.AddressInfo).port;
  await new Promise(r => s.close(r));
  return p;
}
type Relay = {port: number; stop: () => Promise<void>};
async function start(env: Record<string, string>, extra: string[] = [], dbPath = db): Promise<Relay> {
  const port = await freePort();
  const child = spawn(bin, ['-listen', `127.0.0.1:${port}`, '--db', dbPath, ...extra], {env: baseEnv(env), stdio: ['ignore', 'ignore', 'pipe']});
  let err = '';
  child.stderr.on('data', d => { err += d; });
  const exited = new Promise(r => child.on('exit', r));
  for (let i = 0; ; i++) {
    if (child.exitCode !== null) throw new Error('relay exited: ' + err);
    const ok = await new Promise<boolean>(r => { const s = net.connect(port, '127.0.0.1', () => { s.destroy(); r(true); }); s.on('error', () => r(false)); });
    if (ok) break;
    if (i > 200) throw new Error('relay did not start: ' + err);
    await new Promise(r => setTimeout(r, 25));
  }
  return {port, stop: async () => { child.kill('SIGTERM'); await exited; }};
}
// Runs the binary to completion and returns only its exit code.
function runExit(env: Record<string, string>, extra: string[], stdin = '', dbPath = db): Promise<number> {
  return new Promise(r => {
    const child = spawn(bin, ['--db', dbPath, ...extra], {env: baseEnv(env), stdio: ['pipe', 'ignore', 'ignore']});
    child.stdin.end(stdin);
    child.on('exit', code => r(code ?? -1));
  });
}

// ---- requests and transcript
const out: string[] = [];
const ids = new Map<string, string>();
const label = (id: string) => {
  if (!ids.has(id)) ids.set(id, 'P' + (ids.size + 1));
  return ids.get(id)!;
};
function normalize(text: string) {
  return text
    .replace(/"created":(\d+),"expires":(\d+)/g, (_m, c, e) => `"created":"T","expires":"T+${Math.round((+e - +c) / 86400)}d"`)
    .replace(/\b[a-fA-F0-9]{64}\b/g, m => m === m.toLowerCase() ? label(m) : label(m.toLowerCase()) + '(uppercased)');
}
function showBody(body: Buffer, sortList: boolean) {
  const text = body.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(body)) return body.length > 2048 ? `<${body.length} bytes sha256 ${crypto.createHash('sha256').update(body).digest('hex')}>` : 'base64:' + body.toString('base64');
  let n = normalize(text);
  if (sortList && n.startsWith('[')) {
    const items = n.match(/\{[^{}]*\}/g) ?? [];
    if ('[' + items.join(',') + ']\n' !== n) throw new Error('unexpected list shape: ' + n);
    n = '[' + items.sort().join(',') + ']\n';
  }
  return n.length > 2048 ? `<${body.length} bytes, normalized sha256 ${crypto.createHash('sha256').update(n).digest('hex')}>` : JSON.stringify(n);
}
type Res = {status: number; headers: string[][]; body: Buffer};
async function send(r: Relay, method: string, p: string, headers: Record<string, string | string[]> = {}, body?: Buffer | string, secure = false): Promise<Res | {error: string}> {
  const payload = body === undefined ? undefined : Buffer.from(body);
  if (payload) headers = {'content-length': String(payload.length), ...headers};
  return new Promise(resolve => {
    let done = false, responded = false;
    const finish = (v: Res | {error: string}) => { if (!done) { done = true; resolve(v); } };
    const q = (secure ? https : http).request({host: '127.0.0.1', port: r.port, method, path: p, headers, agent: false, rejectUnauthorized: false}, res => {
      responded = true;
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const h: string[][] = [];
        for (let i = 0; i < res.rawHeaders.length; i += 2) if (res.rawHeaders[i].toLowerCase() !== 'date') h.push([res.rawHeaders[i].toLowerCase(), res.rawHeaders[i + 1]]);
        h.sort((a, b) => (a[0] + '\0' + a[1]).localeCompare(b[0] + '\0' + b[1]));
        finish({status: res.statusCode!, headers: h, body: Buffer.concat(chunks)});
      });
      res.on('error', e => finish({error: (e as any).code ?? e.message}));
    });
    q.on('error', e => setTimeout(() => finish({error: (e as any).code ?? e.message}), 300));
    if (!payload) { q.end(); return; }
    // Stream the body and stop once the relay has answered, like a real client
    // would; flooding a closed connection only turns the answer into a reset.
    (async () => {
      for (let i = 0; i < payload.length && !responded && !done; i += 1 << 16)
        if (!q.write(payload.subarray(i, i + (1 << 16)))) await new Promise(r => { const f = () => { q.off('drain', f); q.off('close', f); r(null); }; q.on('drain', f); q.on('close', f); });
      if (!responded && !done) q.end();
    })();
  });
}
async function step(r: Relay, name: string, method: string, p: string, headers: Record<string, string | string[]> = {}, body?: Buffer | string, extra: {list?: boolean; secure?: boolean} = {}) {
  const res = await send(r, method, p, headers, body, extra.secure);
  if ('error' in res) { out.push(`## ${name}\n${method} ${normalize(p)}\nerror ${res.error}`); return res; }
  out.push(`## ${name}\n${method} ${normalize(p)}\n${res.status}\n` + res.headers.map(([k, v]) => `${k}: ${normalize(v)}`).join('\n') + '\n' + showBody(res.body, !!extra.list));
  return res;
}
const auth = {authorization: 'Bearer ' + TOKEN};
const json = (v: unknown) => JSON.stringify(v);
const pattern = (size: number, seed: number) => {
  const b = Buffer.alloc(size);
  for (let i = 0; i < size; i++) b[i] = (seed * 31 + i * 7 + (i >> 8)) & 255;
  return b;
};
const blobID = (n: number) => n.toString(16).padStart(8, '0') + '-0000-0000-0000-' + n.toString(16).padStart(12, '0');
const BLOB = '3d8f6a2e-1b7c-4e5f-9a0b-8c7d6e5f4a3b';

// ---- write side: changes, blobs, publications, recovery registration
async function authGate(r: Relay) {
  // Auth gate
  await step(r, 'no auth', 'GET', '/v1/changes');
  await step(r, 'wrong token', 'GET', '/v1/changes', {authorization: 'Bearer ' + 'x'.repeat(TOKEN.length)});
  await step(r, 'lowercase bearer', 'GET', '/v1/changes', {authorization: 'bearer ' + TOKEN});
  await step(r, 'raw token without Bearer', 'GET', '/v1/changes', {authorization: TOKEN});
  await step(r, 'two auth headers, good first', 'GET', '/v1/changes', {authorization: ['Bearer ' + TOKEN, 'Bearer bad']});
  await step(r, 'two auth headers, bad first', 'GET', '/v1/changes', {authorization: ['Bearer bad', 'Bearer ' + TOKEN]});
  await step(r, 'unknown path unauthenticated', 'GET', '/v1/nothing');
  await step(r, 'unknown path', 'GET', '/v1/nothing', auth);
  await step(r, 'root', 'GET', '/', auth);
  await step(r, 'changes trailing slash', 'GET', '/v1/changes/', auth);
  await step(r, 'changes percent-encoded', 'GET', '/v1/%63hanges', auth);
  await step(r, 'bad escape in path', 'GET', '/v1/%zzchanges', auth);
  await step(r, 'encoded slash in blob path', 'GET', '/v1/blobs/' + BLOB.slice(0, 8) + '%2D' + BLOB.slice(9), auth);
  for (const m of ['PUT', 'DELETE', 'HEAD', 'PATCH', 'OPTIONS']) await step(r, 'changes method ' + m, m, '/v1/changes', auth);
}
async function recordPushes(r: Relay) {
  // Record pushes
  for (let i = 0; i < 3; i++) await step(r, 'post ' + i, 'POST', '/v1/changes', auth, json({id: `unique-record-${String(i).padStart(4, '0')}`, blob: 'encrypted-' + i}));
  await step(r, 'replay same payload', 'POST', '/v1/changes', auth, json({id: 'unique-record-0000', blob: 'encrypted-0'}));
  await step(r, 'conflicting payload', 'POST', '/v1/changes', auth, json({id: 'unique-record-0000', blob: 'changed'}));
  await step(r, 'id 15 chars', 'POST', '/v1/changes', auth, json({id: 'x'.repeat(15), blob: 'b'}));
  await step(r, 'id 16 chars', 'POST', '/v1/changes', auth, json({id: 'y'.repeat(16), blob: 'b'}));
  await step(r, 'id 128 chars', 'POST', '/v1/changes', auth, json({id: 'z'.repeat(128), blob: 'b'}));
  await step(r, 'id 129 chars', 'POST', '/v1/changes', auth, json({id: 'w'.repeat(129), blob: 'b'}));
  await step(r, 'id multibyte bytes', 'POST', '/v1/changes', auth, json({id: '한글아이디다섯자', blob: 'b'}));
  await step(r, 'empty blob', 'POST', '/v1/changes', auth, json({id: 'empty-blob-000001', blob: ''}));
  await step(r, 'unknown field', 'POST', '/v1/changes', auth, json({id: 'unknown-field-0001', blob: 'b', extra: 1}));
  await step(r, 'case-insensitive keys', 'POST', '/v1/changes', auth, '{"ID":"case-insensitive-01","BLOB":"b"}');
  await step(r, 'duplicate keys last wins', 'POST', '/v1/changes', auth, '{"id":"dup-first-000000001","blob":"b","id":"dup-second-00000001"}');
  await step(r, 'null keeps earlier', 'POST', '/v1/changes', auth, '{"id":"null-keeps-000000001","blob":"b","blob":null}');
  await step(r, 'client seq ignored', 'POST', '/v1/changes', auth, '{"seq":99,"id":"client-seq-0000001","blob":"b"}');
  await step(r, 'negative seq', 'POST', '/v1/changes', auth, '{"seq":-1,"id":"negative-seq-00001","blob":"b"}');
  await step(r, 'float seq', 'POST', '/v1/changes', auth, '{"seq":1.5,"id":"float-seq-00000001","blob":"b"}');
  await step(r, 'string seq', 'POST', '/v1/changes', auth, '{"seq":"1","id":"string-seq-0000001","blob":"b"}');
  await step(r, 'numeric id', 'POST', '/v1/changes', auth, '{"id":12345678901234567,"blob":"b"}');
  await step(r, 'null body', 'POST', '/v1/changes', auth, 'null');
  await step(r, 'array body', 'POST', '/v1/changes', auth, '[]');
  await step(r, 'empty body', 'POST', '/v1/changes', auth, '');
  await step(r, 'invalid json', 'POST', '/v1/changes', auth, '{"id":');
  await step(r, 'trailing object', 'POST', '/v1/changes', auth, json({id: 'trailing-obj-0001', blob: 'b'}) + ' {}');
  await step(r, 'trailing garbage', 'POST', '/v1/changes', auth, json({id: 'trailing-junk-001', blob: 'b'}) + 'x');
  await step(r, 'trailing whitespace', 'POST', '/v1/changes', auth, json({id: 'trailing-space-01', blob: 'b'}) + ' \n\t\r ');
  await step(r, 'invalid id and trailing', 'POST', '/v1/changes', auth, json({id: 'short', blob: 'b'}) + 'x');
  await step(r, 'escapes and html chars', 'POST', '/v1/changes', auth, '{"id":"escape-record-0001","blob":"<a href=\\"x\\">&amp;</a> \\u00e9 \\u2028 \\u2029 \\b\\f\\n\\r\\t\\u0001\\u001f \\/ \\ud83d\\ude00 \u007f"}');
  await step(r, 'raw unicode', 'POST', '/v1/changes', auth, json({id: 'unicode-record-001', blob: '노트 ✓ 😀 \u2028'}));
  await step(r, 'whitespace before', 'POST', '/v1/changes', auth, '  \n' + json({id: 'leading-space-0001', blob: 'b'}));
  await step(r, 'blob over MaxBlob', 'POST', '/v1/changes', auth, json({id: 'oversize-blob-001', blob: 'o'.repeat(MAX_BLOB + 1)}));
  await step(r, 'blob exactly MaxBlob', 'POST', '/v1/changes', auth, json({id: 'max-blob-record-1', blob: 'm'.repeat(MAX_BLOB)}));
  await step(r, 'blob 9 MiB', 'POST', '/v1/changes', auth, json({id: 'nine-mib-record-1', blob: 'n'.repeat(9 << 20)}));
  await step(r, 'body over limit', 'POST', '/v1/changes', auth, '{"id":"over-limit-record","blob":"' + 'l'.repeat(MAX_BLOB + 1024) + '"}');
  await step(r, 'valid json then padding over limit', 'POST', '/v1/changes', auth, json({id: 'padding-record-01', blob: 'b'}) + ' '.repeat(MAX_BLOB + 1024));
  await step(r, 'after big records', 'POST', '/v1/changes', auth, json({id: 'after-big-record1', blob: 'small'}));

}
async function blobs(r: Relay) {
  // Blobs
  await step(r, 'blob no auth', 'PUT', '/v1/blobs/' + BLOB, {}, pattern(64, 1));
  await step(r, 'blob size 0', 'PUT', '/v1/blobs/' + blobID(1), auth, Buffer.alloc(0));
  await step(r, 'blob size 39', 'PUT', '/v1/blobs/' + blobID(2), auth, pattern(39, 2));
  await step(r, 'blob size 40', 'PUT', '/v1/blobs/' + blobID(3), auth, pattern(40, 3));
  await step(r, 'blob max', 'PUT', '/v1/blobs/' + blobID(4), auth, pattern(MAX_CHUNK, 4));
  await step(r, 'blob max+1', 'PUT', '/v1/blobs/' + blobID(5), auth, pattern(MAX_CHUNK + 1, 5));
  await step(r, 'blob 1MiB', 'PUT', '/v1/blobs/' + blobID(6), auth, pattern(1 << 20, 6));
  await step(r, 'blob first put', 'PUT', '/v1/blobs/' + BLOB, auth, pattern(4096, 5));
  await step(r, 'blob replay', 'PUT', '/v1/blobs/' + BLOB, auth, pattern(4096, 5));
  await step(r, 'blob conflict', 'PUT', '/v1/blobs/' + BLOB, auth, pattern(4096, 6));
  await step(r, 'blob percent-encoded id put', 'PUT', '/v1/blobs/%30%30%30%30%30%30%30%37-0000-0000-0000-000000000007', auth, pattern(100, 7));
  await step(r, 'blob no content-length (chunked)', 'PUT', '/v1/blobs/' + blobID(8), {...auth, 'transfer-encoding': 'chunked'});
  const bad = [BLOB.toUpperCase(), BLOB.replaceAll('-', ''), '{' + BLOB + '}', 'urn:uuid:' + BLOB, BLOB + '/payload.bin', BLOB + '/', BLOB.slice(0, 35) + 'g', '3d8f6a2e-1b7c-4e5f-9a0b+8c7d6e5f4a3b', BLOB.slice(0, 35), ''];
  for (const id of bad) for (const m of ['PUT', 'GET']) await step(r, 'malformed blob id ' + m + ' ' + id, m, '/v1/blobs/' + id, auth, m === 'PUT' ? pattern(64, 1) : undefined);
  for (const m of ['DELETE', 'POST', 'HEAD', 'PATCH']) await step(r, 'blob method ' + m, m, '/v1/blobs/' + BLOB, auth);
  await step(r, 'blobs without slash', 'GET', '/v1/blobs', auth);

}
async function publications(r: Relay) {
  // Publications
  const payload = json({title: '<script>title</script>', html: "<p onclick='x()'>public only</p><img src='http://127.0.0.1/secret'><script>private()</script>", days: 7});
  await step(r, 'publish no auth', 'POST', '/v1/publications', {}, payload);
  await step(r, 'publish with origin', 'POST', '/v1/publications', {...auth, origin: 'https://evil.test'}, payload);
  await step(r, 'publish empty origin', 'POST', '/v1/publications', {...auth, origin: ''}, json({title: 'empty origin', html: '<p>o</p>', days: 1}));
  await step(r, 'publish cross-site', 'POST', '/v1/publications', {...auth, 'sec-fetch-site': 'cross-site'}, payload);
  await step(r, 'publish Cross-Site case', 'POST', '/v1/publications', {...auth, 'sec-fetch-site': 'Cross-Site'}, json({title: 'case', html: '<p>c</p>', days: 1}));
  await step(r, 'publish query', 'POST', '/v1/publications?x=1', auth, payload);
  await step(r, 'publish empty query', 'POST', '/v1/publications?', auth, json({title: 'empty query', html: '<p>q</p>', days: 2}));
  await step(r, 'publications PUT', 'PUT', '/v1/publications', auth, payload);
  await step(r, 'publications slash GET', 'GET', '/v1/publications/', auth);
  await step(r, 'publications prefix junk', 'GET', '/v1/publicationsX', auth);
  await step(r, 'publications prefix junk origin', 'GET', '/v1/publicationsX', {...auth, origin: 'x'});
  const invalid: [string, string][] = [
    ['days 0', json({title: 't', html: '<p>x</p>', days: 0})], ['days 31', json({title: 't', html: '<p>x</p>', days: 31})],
    ['days string', '{"title":"t","html":"<p>x</p>","days":"7"}'], ['days float', '{"title":"t","html":"<p>x</p>","days":1.5}'],
    ['days missing', json({title: 't', html: '<p>x</p>'})], ['unknown field', json({title: 't', html: '<p>x</p>', days: 1, x: 1})],
    ['title 1025 bytes', json({title: '가'.repeat(341) + 'xx', html: '<p>x</p>', days: 1})], ['null', 'null'], ['array', '[]'],
    ['trailing object', payload + ' {}'], ['oversize body', '{"title":"' + 'x'.repeat(3 << 20) + '","html":"","days":1}'], ['html over limit', json({title: 't', html: 'x'.repeat((2 << 20) + 1), days: 1})],
    ['nesting 130', json({title: 't', html: '<div>'.repeat(130) + 'deep', days: 1})],
  ];
  for (const [name, body] of invalid) await step(r, 'publish invalid ' + name, 'POST', '/v1/publications', auth, body);
  const pages: [string, string, string][] = [
    ['test payload', '<script>title</script>', "<p onclick='x()'>public only</p><img src='http://127.0.0.1/secret'><script>private()</script>"],
    ['title 1024 bytes', '가'.repeat(341) + 'x', '<p>x</p>'],
    ['misnested', 'm', '<b><i>misnested</b></i> text <p>unclosed <div>block</div><a><p>x</a>y'],
    ['tables', 't', '<table><tr><td>a<td>b</table><table><b>foster</b><tr><th>c</th></tr></table><td>stray</td>'],
    ['hidden', 'h', '<p hidden>h</p><p style="display: none">x</p><p style="color:red; visibility:hidden !important">y</p><span aria-hidden="TRUE">z</span><p style="displaynone">kept</p><p STYLE="DISPLAY:NONE">upper</p><p style="display: none">nbsp</p>'],
    ['attachments', 'a', '<div data-type="mindbox-attachment">att</div><a data-attachment-url="x">u</a><a href="javascript:1">link</a><p data-type="other">other</p>'],
    ['entities', 'e', '&lt;&amp;&quot;&#39; &nbsp; &copy; "quotes" \'single\' < raw &unknown; &#x1F600;'],
    ['head content', 'hd', '<!-- comment --><!doctype html><title>t</title><style>p{}</style><meta charset=x><p>after head</p><!-- c2 -->'],
    ['blocked', 'b', '<svg><text>s</text></svg><math><mi>x</mi></math><template><p>t</p></template><noscript>n</noscript><form><input value=v><textarea>ta</textarea><button>b</button><select><option>o</option></select></form><iframe>if</iframe><object>ob</object><embed>'],
    ['structure', 's', '<pre>  spaced\n  code</pre><code>c</code><blockquote>q</blockquote><ul><li>1<li>2</ul><ol><li>3</ol><h1>H</h1><h6>6</h6><hr><br>tail<s>s</s><u>u</u><em>e</em><strong>st</strong>'],
    ['nesting 126', 'n', '<div>'.repeat(126) + 'deep'],
    ['nesting 127', 'n', '<div>'.repeat(127) + 'deep'],
    ['formatting reconstruction', 'f', '<b>' + '<i>'.repeat(20) + 'x</b>' + '<p>after</p>'.repeat(3)],
    ['nul and newlines', 'z', 'a\u0000b\r\nc\rd<p>\u0000</p>'],
    ['unicode', 'u', '<p>노트 ✓ 😀 \u2028 \u2029 &amp; <>"\'</p>'],
    ['raw text elements', 'r', '<p>x<xmp><b>y</b></xmp><plaintext><b>z</b></p>'],
    ['image and misc', 'i', '<image src=x alt=y><p>1<p>2<li>orphan</li><caption>cap</caption><body><p>dup body</p></body></html><p>after html</p>'],
    ['big page', 'big', '<p>' + 'x'.repeat(3000) + '</p>'],
    ['exact limit', 'lim', 'x'.repeat(2 << 20)],
    ['title escape', '"quoted" & <tag> \'apos\' \u2028', '<p>t</p>'],
    ['empty html', '', ''],
  ];
  const created: string[] = [];
  for (const [name, title, html] of pages) {
    const res = await step(r, 'publish ' + name, 'POST', '/v1/publications', {...auth, 'sec-fetch-site': 'same-origin'}, json({title, html, days: 7}));
    if (!('error' in res) && res.status === 201) created.push(JSON.parse(res.body.toString()).id);
  }
  for (let i = 0; i < 100; i++) {
    const res = await send(r, 'POST', '/v1/publications', auth, json({title: 'fill ' + i, html: '<p>fill</p>', days: 1}));
    if ('error' in res || res.status !== 201) { await step(r, 'publish fill stops at ' + i, 'POST', '/v1/publications', auth, json({title: 'fill', html: '<p>f</p>', days: 1})); break; }
    const id = JSON.parse(res.body.toString()).id;
    label(id);
    created.push(id);
  }
  await step(r, 'revoke unauthenticated', 'DELETE', '/v1/publications/' + created[1]);
  await step(r, 'revoke', 'DELETE', '/v1/publications/' + created[1], auth);
  await step(r, 'revoke again', 'DELETE', '/v1/publications/' + created[1], auth);
  await step(r, 'revoke unknown', 'DELETE', '/v1/publications/' + 'a'.repeat(64), auth);
  await step(r, 'revoke malformed', 'DELETE', '/v1/publications/' + 'A'.repeat(64), auth);
  await step(r, 'revoke with origin', 'DELETE', '/v1/publications/' + created[2], {...auth, origin: 'x'});
  await step(r, 'revoked page', 'GET', '/p/' + created[1]);
  await step(r, 'publish after revoke frees slot', 'POST', '/v1/publications', auth, json({title: 'after revoke', html: '<p>r</p>', days: 30}));

}
async function recovery(r: Relay) {
  // Recovery registration (recovery enabled on this relay)
  const rk = '/v1/recovery/key';
  await step(r, 'recovery no auth', 'GET', rk);
  await step(r, 'recovery relay token is not google', 'GET', rk, auth);
  await step(r, 'recovery basic auth', 'GET', rk, {authorization: 'Basic eDp5'});
  await step(r, 'recovery two headers', 'GET', rk, {authorization: ['Bearer ' + idToken(), 'Bearer ' + idToken()]});
  await step(r, 'recovery POST', 'POST', rk, {authorization: 'Bearer ' + idToken()}, '{}');
  await step(r, 'recovery HEAD', 'HEAD', rk, {authorization: 'Bearer ' + idToken()});
  await step(r, 'recovery GET unregistered', 'GET', rk, {authorization: 'Bearer ' + idToken()});
  await step(r, 'recovery query ignored', 'GET', rk + '?x=1', {authorization: 'Bearer ' + idToken()});
  const tokens: [string, string][] = [
    ['garbage', 'not.a.token'], ['four parts', idToken() + '.x'], ['oversize', 'a'.repeat(64 << 10) + 'b'],
    ['wrong owner', idToken(c => { c.sub = 'other-subject'; })], ['forged', idToken(undefined, forged.privateKey)],
    ['expired', idToken(c => { c.exp = Math.floor(Date.now() / 1000) - 1; })], ['wrong aud', idToken(c => { c.aud = '999999-bad.apps.googleusercontent.com'; })],
    ['alg HS256', idToken((_c, h) => { h.alg = 'HS256'; })], ['no kid', idToken((_c, h) => { delete h.kid; })], ['unknown kid', idToken((_c, h) => { h.kid = 'other'; })],
    ['crit header', idToken((_c, h) => { h.crit = ['exp']; })], ['future iat', idToken(c => { c.iat += 600; })], ['future nbf', idToken(c => { c.nbf = c.iat + 600; })],
    ['zero iat', idToken(c => { c.iat = 0; })], ['bad issuer', idToken(c => { c.iss = 'https://evil.test'; })],
    ['short issuer ok', idToken(c => { c.iss = 'accounts.google.com'; })], ['aud array ok', idToken(c => { c.aud = [CLIENT]; })],
    ['aud array two without azp', idToken(c => { c.aud = [CLIENT, 'x']; })], ['aud array two with azp', idToken(c => { c.aud = [CLIENT, 'x']; c.azp = CLIENT; })],
    ['azp mismatch', idToken(c => { c.azp = 'x'; })], ['aud number', idToken(c => { c.aud = 5; })],
    ['uppercase claim keys', idToken(undefined, undefined, `{"ISS":"https://accounts.google.com","SUB":"${SUBJECT}","Aud":"${CLIENT}","IAT":${Math.floor(Date.now() / 1000)},"EXP":${Math.floor(Date.now() / 1000) + 3600}}`)],
    ['null sub after real', idToken(undefined, undefined, `{"iss":"https://accounts.google.com","sub":"${SUBJECT}","sub":null,"aud":"${CLIENT}","iat":${Math.floor(Date.now() / 1000)},"exp":${Math.floor(Date.now() / 1000) + 3600}}`)],
    ['float exp', idToken(undefined, undefined, `{"iss":"https://accounts.google.com","sub":"${SUBJECT}","aud":"${CLIENT}","iat":${Math.floor(Date.now() / 1000)},"exp":1.5e10}`)],
    ['sub with space', idToken(c => { c.sub = 'a b'; })], ['nonce ignored', idToken(c => { c.nonce = 'n'; })],
  ];
  for (const [name, t] of tokens) for (const m of ['GET', 'PUT']) await step(r, 'recovery token ' + name + ' ' + m, m, rk, {authorization: 'Bearer ' + t}, m === 'PUT' ? json({key: VAULT}) : undefined);
  const put = (name: string, body: string) => step(r, 'recovery put ' + name, 'PUT', rk, {authorization: 'Bearer ' + idToken()}, body);
  await put('43 chars', json({key: VAULT.slice(1)}));
  await put('invalid base64', json({key: '!' + VAULT.slice(1)}));
  await put('non-canonical padding', json({key: VAULT.slice(0, 42) + 'B='}));
  await put('31 bytes', json({key: Buffer.alloc(31, 1).toString('base64')}));
  await put('unknown field', '{"key":"' + VAULT + '","x":1}');
  await put('trailing', json({key: VAULT}) + 'x');
  await put('oversize', json({key: VAULT}) + ' '.repeat(3000));
  await put('null', 'null');
  await put('empty', '');
  for (const mode of ['fail', 'dup']) { jwksMode = mode; await step(r, 'recovery jwks ' + mode, 'GET', rk, {authorization: 'Bearer ' + idToken()}); }
  jwksMode = 'ok';
  await put('uppercase KEY registers', '{"KEY":"' + VAULT + '"}');
  await put('same key again', json({key: VAULT}));
  await put('different key conflicts', json({key: OTHER_VAULT}));
}

// ---- read side: must be identical on any DB holding the same data
async function writeSide(r: Relay) {
  for (const section of [authGate, recordPushes, blobs, publications, recovery]) await section(r);
}

async function readSide(r: Relay) {
  await step(r, 'read changes default', 'GET', '/v1/changes', auth);
  for (const q of ['after=1&limit=1', 'after=0&limit=100', 'limit=100', 'after=3', 'after=+1', 'limit=+5', 'limit=-1', 'limit=0', 'limit=101', 'limit=abc', 'after=-1', 'after=abc', 'after=',
    'after=18446744073709551615', 'after=18446744073709551614', 'after=18446744073709551616', 'after=1&after=2', 'after=1;limit=2', '%61fter=2', 'after=%32', 'after=2&limit=%zz', 'limit=1&limit=500', 'after=+', 'limit=1e1', 'limit=+0100', 'after=00002'])
    await step(r, 'read changes ?' + q, 'GET', '/v1/changes?' + q, auth);
  // Walk the full stream with the cursor the relay hands out, as a client does.
  let cursor = 0;
  for (let i = 0; i < 40; i++) {
    const res = await step(r, 'cursor walk from ' + cursor, 'GET', `/v1/changes?after=${cursor}&limit=7`, auth);
    if ('error' in res || res.status !== 200) break;
    const page = JSON.parse(res.body.toString());
    if (page.items.length === 0) break;
    cursor = page.cursor;
  }
  for (const id of [blobID(3), blobID(4), BLOB, blobID(7), blobID(99), blobID(5)]) await step(r, 'read blob ' + id, 'GET', '/v1/blobs/' + id, auth);
  await step(r, 'read blob unauthenticated', 'GET', '/v1/blobs/' + BLOB);
  const list = await step(r, 'list publications', 'GET', '/v1/publications', auth, undefined, {list: true});
  await step(r, 'list publications with origin', 'GET', '/v1/publications', {...auth, origin: 'https://x'});
  await step(r, 'list publications query', 'GET', '/v1/publications?x', auth);
  const listed: {id: string; title: string}[] = 'error' in list ? [] : JSON.parse(list.body.toString());
  listed.sort((a, b) => label(a.id).localeCompare(label(b.id), 'en', {numeric: true}));
  for (const p of listed.filter(p => !p.title.startsWith('fill ') || p.title === 'fill 0')) {
    const name = label(p.id);
    await step(r, 'page ' + name, 'GET', '/p/' + p.id);
  }
  const first = listed[0]?.id ?? 'a'.repeat(64);
  await step(r, 'page HEAD', 'HEAD', '/p/' + first);
  await step(r, 'page POST', 'POST', '/p/' + first, {}, 'x');
  await step(r, 'page query', 'GET', '/p/' + first + '?x=1');
  await step(r, 'page empty query', 'GET', '/p/' + first + '?');
  await step(r, 'page extra segment', 'GET', '/p/' + first + '/extra');
  await step(r, 'page uppercase', 'GET', '/p/' + first.toUpperCase());
  await step(r, 'page dotdot', 'GET', '/p/../../v1/changes');
  await step(r, 'page empty', 'GET', '/p/');
  await step(r, 'page unknown', 'GET', '/p/' + 'b'.repeat(64));
  await step(r, 'page with auth', 'GET', '/p/' + first, auth);
  await step(r, 'recovery GET registered', 'GET', '/v1/recovery/key', {authorization: 'Bearer ' + idToken()});
  await step(r, 'recovery wrong owner', 'GET', '/v1/recovery/key', {authorization: 'Bearer ' + idToken(c => { c.sub = 'other'; })});
}

// ---- process-level checks (flags, env fallback, offline key registration, TLS)
async function cliSide() {
  const alt = path.join(work, 'cli.db');
  const code = async (name: string, env: Record<string, string>, extra: string[], stdin = '', dbPath = alt) => out.push(`## exit ${name}\n${await runExit(env, extra, stdin, dbPath)}`);
  await code('short token', {INKISM_RELAY_TOKEN: 'short'}, ['-listen', '127.0.0.1:1']);
  await code('unknown flag', {INKISM_RELAY_TOKEN: TOKEN}, ['--nope']);
  await code('missing flag value', {INKISM_RELAY_TOKEN: TOKEN}, ['--listen']);
  await code('invalid master key', {...recoveryEnv, INKISM_RECOVERY_MASTER_KEY: 'not base64!'}, ['-listen', '127.0.0.1:1', '--register-owner-key-stdin'], VAULT);
  await code('short master key', {...recoveryEnv, INKISM_RECOVERY_MASTER_KEY: Buffer.alloc(31).toString('base64')}, ['--register-owner-key-stdin'], VAULT);
  await code('invalid client id', {...recoveryEnv, INKISM_RECOVERY_GOOGLE_CLIENT_ID: 'bad'}, ['--register-owner-key-stdin'], VAULT);
  await code('subject only', {INKISM_RELAY_TOKEN: TOKEN, INKISM_RECOVERY_GOOGLE_SUBJECT: SUBJECT}, ['--register-owner-key-stdin'], VAULT);
  await code('register without recovery', {INKISM_RELAY_TOKEN: TOKEN}, ['--register-owner-key-stdin'], VAULT);
  await code('register 46 bytes', recoveryEnv, ['--register-owner-key-stdin'], VAULT + '\n\n');
  await code('register 45 bytes', recoveryEnv, ['-register-owner-key-stdin=true'], ' ' + VAULT);
  await code('register same key', recoveryEnv, ['--register-owner-key-stdin'], VAULT + '\n');
  await code('register different key', recoveryEnv, ['--register-owner-key-stdin'], OTHER_VAULT);
  await code('register different subject', {...recoveryEnv, INKISM_RECOVERY_GOOGLE_SUBJECT: 'other'}, ['--register-owner-key-stdin'], VAULT);
  await code('register wrong master', {...recoveryEnv, INKISM_RECOVERY_MASTER_KEY: Buffer.alloc(32, 8).toString('base64')}, ['--register-owner-key-stdin'], VAULT);
  // NOOK_ fallback (INKISM_ wins, empty INKISM_ falls back) and recovery via legacy names.
  const legacy = await start({INKISM_RELAY_TOKEN: '', NOOK_RELAY_TOKEN: TOKEN, NOOK_RECOVERY_GOOGLE_CLIENT_ID: CLIENT, NOOK_RECOVERY_GOOGLE_SUBJECT: SUBJECT, NOOK_RECOVERY_MASTER_KEY: MASTER}, [], alt);
  await step(legacy, 'legacy env token', 'GET', '/v1/changes', auth);
  await step(legacy, 'legacy env recovery key from offline registration', 'GET', '/v1/recovery/key', {authorization: 'Bearer ' + idToken()});
  await code('register while relay runs', recoveryEnv, ['--register-owner-key-stdin'], VAULT);
  await legacy.stop();
  const disabled = await start({INKISM_RELAY_TOKEN: TOKEN, NOOK_RELAY_TOKEN: 'ignored-because-inkism-is-set-000000'}, [], alt);
  await step(disabled, 'recovery disabled', 'GET', '/v1/recovery/key', {authorization: 'Bearer ' + idToken()});
  await step(disabled, 'recovery disabled PUT', 'PUT', '/v1/recovery/key', {}, '{}');
  await step(disabled, 'INKISM wins over NOOK', 'GET', '/v1/changes?limit=1', auth);
  await disabled.stop();
  const secure = await start({INKISM_RELAY_TOKEN: TOKEN}, ['--tls-cert', path.join(work, 'leaf.pem'), '--tls-key', path.join(work, 'leaf.key')], alt);
  await step(secure, 'tls listener', 'GET', '/v1/changes?limit=1', auth, undefined, {secure: true});
  await secure.stop();
}

try {
  const relay = await start(recoveryEnv);
  try {
    if (phase === 'full') await writeSide(relay);
    await readSide(relay);
  } finally { await relay.stop(); }
  if (phase === 'full') await cliSide();
  process.stdout.write(out.join('\n\n') + '\n');
} finally {
  proxy.close();
  fs.rmSync(work, {recursive: true, force: true});
}
