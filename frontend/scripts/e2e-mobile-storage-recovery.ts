import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from './browser-env.ts';
const root = process.env.INKISM_SOURCE_ROOT || process.cwd();
const html = readFileSync(resolve(root, 'desktop-tauri/src-tauri/src/mobile-storage-recovery.html'), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(() => {
    (window as any).calls = [];
    (window as any).__TAURI_INTERNALS__ = { invoke: async (name: string) => {
      (window as any).calls.push(name); throw new Error('key unavailable');
    } };
  });
  await page.route('http://inkism.test/**', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('http://inkism.test/');
  await page.getByRole('heading', { name: '보관함을 열 수 없습니다' }).waitFor();
  assert.deepEqual(await page.evaluate(() => (window as any).calls), []);
  await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '아직 열 수 없습니다' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '다시 시도', exact: true }).isEnabled(), true);
  assert.deepEqual(await page.evaluate(() => (window as any).calls), ['mobile_retry_storage']);
  await page.getByRole('button', { name: '안전 복구 안내', exact: true }).click();
  await page.getByRole('heading', { name: '기존 자료를 보존하며 복구하기' }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  console.log('PASS no automatic DB IPC, retry failure stays usable, safe recovery guide, mobile layout');
} finally { await browser.close(); }
