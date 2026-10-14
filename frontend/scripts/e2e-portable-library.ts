// A synthetic API library only. Exercise actual Rust ZIP export and revisioned
// imports through the same helper used by the folder picker.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { readZipEntries } from "./read-zip.ts";
const base=process.env.INKISM_URL || "http://127.0.0.1:49311";
const rpc=async(op:string,args={})=>{const response=await fetch(base+"/api/rpc",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({op,...args})});const env=await response.json();if(!response.ok || !env.ok)throw new Error(env.error || String(response.status));return env.data;};
const output=await build({stdin:{contents:"export * from './lib/portable-library';",resolveDir:new URL("../src/",import.meta.url).pathname,loader:"ts"},bundle:true,write:false,format:"cjs",platform:"node",logLevel:"error"});const module={exports:{} as any};new Function("module","exports",output.outputFiles[0].text)(module,module.exports);const {planPortableImport,applyPortablePlan}=module.exports;
const bytes=Buffer.from("original attachment\0\r\n한글");const form=new FormData();form.append("file",new Blob([bytes]),"photo.bin");form.append("size",String(bytes.length));const up=await fetch(base+"/api/attachments",{method:"POST",body:form});const attachment=(await up.json()).data;
const daily=await rpc("daily_note",{date:"2026-10-12",content_format:"markdown"});
const html=await rpc("save",{note:{title:"Rich outside",content:'<p><span style="color:red">Original</span></p>',content_format:"html"}});
const source=`\ufeff# Markdown\r\n[rich](note://${html.id})\r\n[file](/api/attachments/${attachment.id})`;
const md=await rpc("save",{note:{title:"Portable source",content:source,content_format:"markdown"}});
const response=await fetch(base+"/api/portable/export",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});assert.equal(response.status,200,await (response.ok ? Promise.resolve("") : response.text()));const entries=readZipEntries(Buffer.from(await response.arrayBuffer()));const manifest=JSON.parse(entries.get(".inkism-portable.json")!.toString("utf8"));
assert.ok(entries.has(`notes/${daily.id}.md`),"daily ID is portable");
assert.equal(entries.get(`notes/${html.id}.html`)!.toString(),html.content);
const portable=entries.get(`notes/${md.id}.md`)!.toString();assert.ok(portable.startsWith(`---\nid: "${md.id}"\n`));assert.ok(portable.includes("---\n\ufeff# Markdown\r\n"),"body after front matter is byte-exact");assert.ok(portable.includes(`${html.id}.html`));assert.ok(portable.includes(`../attachments/${attachment.id}.bin`));assert.deepEqual(entries.get(`attachments/${attachment.id}.bin`),bytes);
assert.equal(manifest.notes.find((n:any)=>n.id===md.id).revision,md.revision);
const files=()=>[...entries].map(([path,bytes])=>{const file=new File([bytes],path.split("/").pop()!);Object.defineProperty(file,"webkitRelativePath",{value:`folder/${path}`});return file;});
const get=(id:string)=>rpc("get",{id});
const unchanged=await planPortableImport(files(),get);assert.equal(unchanged.changes.length,0);
entries.set(`notes/${md.id}.md`,Buffer.from(portable+"\r\nEdited outside"));
const planned=await planPortableImport(files(),get);assert.equal(planned.changes.length,1);const result=await applyPortablePlan(planned,(note:unknown)=>rpc("save",{note}));assert.equal(result.saved,1);const saved=await get(md.id);assert.equal(saved.content,source+"\r\nEdited outside");assert.equal(saved.content_format,"markdown");assert.ok(saved.revision>md.revision);
const stale=await planPortableImport(files(),get);assert.equal(stale.changes.length,0);assert.equal(stale.conflicts.length,1);assert.equal((await get(html.id)).content,html.content);
assert.equal((await fetch(base+"/api/portable/export")).status,405);
console.log("PASS actual library folder ZIP: exact Markdown/HTML, note/attachment relative links, attachment bytes, outside edits returned, stale source rejected, export leaves original notes intact");
