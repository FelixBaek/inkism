// Synthetic attachment referenced from a note; seed while closed, verify after UI restore.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const [mode,engine,db]=process.argv.slice(2);
assert.ok(['seed','verify'].includes(mode)&&engine&&db);
const bytes=Buffer.from(Array.from({length:600017},(_,i)=>i%251));
const title='Native backup attachment';
const originals=[
 {title:'Backup HTML original',content:'<p>한글 &amp; 원문</p><!-- keep -->',content_format:'html'},
 {title:'Backup text original',content:'한글 <p>literal</p>\r\n  space',content_format:'text'},
 {title:'Backup Markdown original',content:'# 한글\r\n\r\n**원문**  두 칸',content_format:'markdown'},
];
function call(args:string[],input:Buffer=Buffer.alloc(0)) {
 const r=spawnSync(engine,['--db',db,...args],{input,timeout:45000,maxBuffer:4*1024*1024});
 if(r.error)throw r.error;assert.equal(r.status,0,r.stderr.toString());return r.stdout;
}
function rpc(request:object){const r=JSON.parse(call([],Buffer.from(JSON.stringify(request)+'\n')).toString());assert.equal(r.ok,true,r.error);return r.data;}
if(mode==='seed'){
 assert.ok(!rpc({op:'list',view:'all'}).items.some((n:any)=>n.title===title),'fixture must be fresh');
 for(const note of originals)rpc({op:'save',note});
 const asset=JSON.parse(call(['--attachment-import','--attachment-name','백업 검증.bin'],bytes).toString());
 rpc({op:'save',note:{title,content:`<p>첨부 원본</p><a href="/api/attachments/${asset.id}">백업 검증.bin</a>`,content_format:'html'}});
}else{
 assert.equal(rpc({op:'storage_status'}).encrypted,true,'restored target must remain encrypted');
 for(const expected of originals){const rows=rpc({op:'list',view:'all'}).items.filter((n:any)=>n.title===expected.title);assert.equal(rows.length,1);const saved=rpc({op:'get',id:rows[0].id});for(const key of ['content','content_format'] as const)assert.equal(saved[key],expected[key]);}
 const matches=rpc({op:'list',view:'all'}).items.filter((n:any)=>n.title===title);assert.equal(matches.length,1);
 const note=rpc({op:'get',id:matches[0].id});const id=note.content.match(/\/api\/attachments\/([a-f0-9-]+)/)?.[1];assert.ok(id);
 assert.equal(note.content,`<p>첨부 원본</p><a href="/api/attachments/${id}">백업 검증.bin</a>`);
 assert.deepEqual(call(['--attachment-export',id]),bytes);
}
console.log(`PASS native backup ${mode}: referenced binary attachment and encrypted restore`);
