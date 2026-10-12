// Drive the packaged application through native Windows UI Automation.
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
assert.equal(process.platform, 'win32', 'This gate requires real Windows');
const script = path.resolve(import.meta.dirname, '../../tools/scripts/test-windows-source-ui.ps1');
const timeout=process.env.INKISM_TEST_WINDOWED_ONLY==='APPROVED_SYNTHETIC_PROFILE_ONLY'?600000:300000;
const result = spawnSync('powershell.exe', ['-NoProfile', '-STA', '-File', script], {stdio:'inherit', timeout});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
