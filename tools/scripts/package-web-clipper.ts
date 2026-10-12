// Package only the explicitly listed extension sources; never app/private data.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = path.resolve(import.meta.dirname, '..', '..');
const source = path.join(root, 'tools', 'extensions', 'web-clipper');
const paths: Record<string, string> = {};
for (const n of ['manifest.json', 'popup.html', 'popup.css', 'popup.js', 'capture.js']) paths[n] = path.join(source, n);
paths['README.txt'] = path.join(root, '.private', 'tools', 'extensions', 'web-clipper', 'README.txt');
const files = Object.keys(paths).filter(n => fs.existsSync(paths[n]));
const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8').replace(/^﻿/, ''));
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');
let commit: string, dirty: boolean;
try {
  commit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
  dirty = Boolean(execFileSync('git', ['status', '--porcelain'], {cwd: root, encoding: 'utf8'}).trim());
} catch {
  [commit, dirty] = ['unknown', true];
}
const metadata = {version: manifest.version, source_commit: commit, source_dirty: dirty,
  validation: 'UNVALIDATED: installed extension activeTab gesture/native app acceptance not run',
  sha256: Object.fromEntries(files.map(name => [name, sha256(fs.readFileSync(paths[name]))]))};
const out = path.join(root, 'dist', 'Inkism-web-clipper-unvalidated.zip');
fs.mkdirSync(path.dirname(out), {recursive: true});

// No zip in the Node stdlib: minimal DEFLATE writer.
// ponytail: no zip64, fine while the archive stays far below 4 GB.
const dosTime = (d: Date) => [(d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()];
const entries = files.map(name => ({name: 'Inkism-web-clipper/' + name, data: fs.readFileSync(paths[name]), date: fs.statSync(paths[name]).mtime}));
entries.push({name: 'Inkism-web-clipper/BUILD.json', data: Buffer.from(JSON.stringify(metadata, null, 2) + '\n'), date: new Date()});
const locals: Buffer[] = [], central: Buffer[] = [];
let offset = 0;
for (const {name, data, date} of entries) {
  const fileName = Buffer.from(name), packed = zlib.deflateRawSync(data), [time, day] = dosTime(date);
  const fields = (header: Buffer, at: number) => {
    header.writeUInt16LE(20, at); header.writeUInt16LE(0x800, at + 2); header.writeUInt16LE(8, at + 4);
    header.writeUInt16LE(time, at + 6); header.writeUInt16LE(day, at + 8); header.writeUInt32LE(zlib.crc32(data), at + 10);
    header.writeUInt32LE(packed.length, at + 14); header.writeUInt32LE(data.length, at + 18); header.writeUInt16LE(fileName.length, at + 22);
  };
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); fields(local, 4);
  const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); fields(entry, 6); entry.writeUInt32LE(offset, 42);
  locals.push(local, fileName, packed); central.push(entry, fileName);
  offset += 30 + fileName.length + packed.length;
}
const directory = Buffer.concat(central), end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
fs.writeFileSync(out, Buffer.concat([...locals, directory, end]));

// Read back like ZipFile.testzip(): every entry inflates to its recorded CRC.
const archive = fs.readFileSync(out), eocd = archive.length - 22;
let at = archive.readUInt32LE(eocd + 16), count = archive.readUInt16LE(eocd + 10);
for (let i = 0; i < count; i++) {
  const crc = archive.readUInt32LE(at + 16), size = archive.readUInt32LE(at + 20), local = archive.readUInt32LE(at + 42);
  const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
  const data = zlib.inflateRawSync(archive.subarray(start, start + size));
  if (zlib.crc32(data) !== crc) throw new Error('zip entry CRC mismatch');
  at += 46 + archive.readUInt16LE(at + 28) + archive.readUInt16LE(at + 30) + archive.readUInt16LE(at + 32);
}
if (count !== files.length + 1) throw new Error('zip entry count mismatch');
const checksum = sha256(archive);
fs.writeFileSync(out + '.sha256', checksum + '  ' + path.basename(out) + '\n', 'ascii');
console.log(out);
console.log(checksum);
