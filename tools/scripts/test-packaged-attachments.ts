// Exercise bounded attachment I/O in the packaged Rust binary, independently of notes.
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {DatabaseSync} from 'node:sqlite';

const binary = path.resolve(process.argv[2]);
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'inkism-attachments-'));
try {
  const db = path.join(folder, '한글.db');
  const data = Buffer.from(Array.from({length: 256 * 8193}, (_, i) => i % 256)); // More than eight storage chunks, including a short tail.
  const source = path.join(folder, 'source.bin');
  fs.writeFileSync(source, data);
  const args = ['--db', db];
  const run = (extra: string[], input = Buffer.alloc(0)) => {
    const result = spawnSync(binary, [...args, ...extra], {input, timeout: 30_000, maxBuffer: Infinity});
    if (result.error) throw result.error;
    return result;
  };
  const imported = run(['--attachment-import', '--attachment-name', '한글 파일.bin'], data);
  assert.equal(imported.status, 0, imported.stderr.toString());
  const meta = JSON.parse(imported.stdout.toString());
  assert.equal(meta.size, data.length);
  assert.equal(meta.sha256, createHash('sha256').update(data).digest('hex'));
  const info = run(['--attachment-info', meta.id]);
  assert.ok(info.status === 0);
  assert.deepEqual(JSON.parse(info.stdout.toString()), meta);
  const exported = run(['--attachment-export', meta.id]);
  assert.ok(exported.status === 0 && exported.stdout.equals(data));

  // Hold the attachment writer lock while saving a real note. Attachment work
  // must never acquire the normal engine's mutex/database write lock.
  const core = spawn(binary, args, {stdio: ['pipe', 'pipe', 'ignore']});
  const coreExit = new Promise(resolve => core.once('close', resolve));
  const lines = readline.createInterface({input: core.stdout})[Symbol.asyncIterator]();
  const rpc = async (payload: object) => {
    core.stdin.write(JSON.stringify(payload) + '\n');
    const line = await lines.next();
    const result = JSON.parse(line.done ? '' : line.value);
    assert.ok(result.ok, JSON.stringify(result));
    return result.data;
  };
  try {
    await rpc({op: 'health'});
    const connection = new DatabaseSync(db + '.attachments', {timeout: 5000});
    connection.exec('BEGIN IMMEDIATE');
    const stream = fs.openSync(source, 'r');
    try {
      const importer = spawn(binary, [...args, '--attachment-import', '--attachment-name', 'second.bin'],
        {stdio: [stream, 'pipe', 'pipe']});
      const output: Buffer[] = [], error: Buffer[] = [];
      importer.stdout.on('data', chunk => output.push(chunk));
      importer.stderr.on('data', chunk => error.push(chunk));
      const importerExit = new Promise<number | null>(resolve => importer.once('close', resolve));
      try {
        assert.equal(importer.exitCode, null);
        const before = performance.now();
        const note = await rpc({op: 'save', note: {title: '첨부 중 작성', content: '<p>보존</p>', text: '보존', tags: []}});
        assert.ok(performance.now() - before < 3000, 'note save blocked on attachment DB');
        connection.exec('ROLLBACK');
        let timer: NodeJS.Timeout | undefined;
        const code = await Promise.race([importerExit, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('importer timed out')), 30_000);
        })]).finally(() => clearTimeout(timer));
        assert.equal(code, 0, Buffer.concat(error).toString());
        assert.equal(JSON.parse(Buffer.concat(output).toString()).sha256, meta.sha256);
        assert.equal((await rpc({op: 'get', id: note.id})).content, '<p>보존</p>');
      } finally {
        connection.close();
        if (importer.exitCode === null && importer.signalCode === null) {
          importer.kill();
          await importerExit;
        }
      }
    } finally {
      fs.closeSync(stream);
    }
  } finally {
    core.stdin.end();
    const timer = setTimeout(() => core.kill(), 15_000);
    await coreExit;
    clearTimeout(timer);
  }
} finally {
  fs.rmSync(folder, {recursive: true, force: true});
}
console.log('PASS: packaged attachment import/export/hash/reopen; note save succeeds while attachment DB is locked');
