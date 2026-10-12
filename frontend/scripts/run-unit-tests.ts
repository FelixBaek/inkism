import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const scripts=new URL('./',import.meta.url),root=fileURLToPath(new URL('../../',import.meta.url));
const tests=(await readdir(scripts)).filter(name=>/^test-.*\.ts$/.test(name)&&name!=='test-dev-proxy.ts').sort();
let failed=0;
for(const name of tests) {
 console.log('\nRUN '+name);
 const result=spawnSync(process.execPath,[fileURLToPath(new URL(name,scripts))],{cwd:root,stdio:'inherit'});
 if(result.error || result.status!==0) {failed++;console.error('FAIL '+name,result.error||result.signal||result.status);}
}
console.log('\nPure tests: '+(tests.length-failed)+' passed, '+failed+' failed; live-server test-dev-proxy excluded.');
process.exitCode=failed?1:0;
