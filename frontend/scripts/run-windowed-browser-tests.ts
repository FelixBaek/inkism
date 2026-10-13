// Experimental rich path; passing this does not certify Windows IME or
// virtualization inside one giant table/list/paragraph.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const tests=['segment-navigator','cross-segment-identity','segment-table','lazy-editor','lazy-source-race','lazy-admission','windowed-rich','window-history','window-boundaries','window-join','document-selection','window-composition','window-typing'];
const env={...process.env,INKISM_API_URL:process.env.INKISM_API_URL||process.env.INKISM_URL};
for(const test of tests){
 console.log('WINDOWED BROWSER GATE: '+test);
 const result=spawnSync(process.execPath,[fileURLToPath(new URL('./e2e-'+test+'.ts',import.meta.url))],{env,stdio:'inherit',timeout:180000});
 if(result.error)console.error(result.error.message);
 if(result.status!==0)process.exit(result.status||1);
}
console.log('PASS: '+tests.length+' experimental rich browser gates.');
