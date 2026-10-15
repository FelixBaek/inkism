import assert from 'node:assert/strict';
import {saveFile} from '../src/lib/save-file.ts';

const host = globalThis as any;
const originalDocument = host.document;
const originalTauri = host.__TAURI__;
const originalNative = host.__inkismNativeSave;
let browserClicks = 0;
host.document = {createElement: () => ({click() { browserClicks++; }})};
try {
  host.__inkismNativeSave = true;
  const bytes = new Uint8Array([0, 255, 13, 10, 128]);
  let calls = 0;
  host.__TAURI__ = {core: {invoke: async (command: string, body: Uint8Array, options: any) => {
    calls++;
    assert.equal(command, 'save_export');
    assert.deepEqual(body, bytes);
    assert.equal(decodeURIComponent(options.headers['x-inkism-filename']), '한글 + 파일.pdf');
    return true;
  }}};
  assert.equal(await saveFile(new Blob([bytes]), '한글 + 파일.pdf'), true);
  assert.equal(calls, 1);
  assert.equal(browserClicks, 0);
  host.__TAURI__.core.invoke = async () => false;
  assert.equal(await saveFile(new Blob([bytes]), 'cancel.pdf'), false);
  assert.equal(browserClicks, 0, 'cancelling the save picker must not start a browser download');
  host.__TAURI__.core.invoke = async () => {throw new Error('disk full');};
  await assert.rejects(saveFile(new Blob([bytes]), 'fail.pdf'), /disk full/);
  assert.equal(browserClicks, 0, 'native errors must not fall back to browser downloads');
  delete host.__TAURI__;
  await assert.rejects(saveFile(new Blob([bytes]), 'fail.pdf'), /unavailable/);
  host.__inkismNativeSave = false;
  assert.equal(await saveFile(new Blob([bytes]), 'browser.pdf'), true);
  assert.equal(browserClicks, 1);
  console.log('PASS native export bytes, Unicode filename, cancellation, error propagation and browser fallback');
} finally {
  host.document = originalDocument;
  host.__TAURI__ = originalTauri;
  host.__inkismNativeSave = originalNative;
}
