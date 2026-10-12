import assert from 'node:assert/strict';import {build} from 'esbuild';
const b=await build({stdin:{contents:"export * from './lib/font-resources';",resolveDir:new URL('../src/',import.meta.url).pathname,loader:'ts'},bundle:true,write:false,format:'cjs',platform:'node',logLevel:'error'});
const pending:(()=>void)[]=[],faces=new Set();let loads=0;
(globalThis as any).window=new EventTarget();(globalThis as any).document={documentElement:{lang:''},fonts:{add:(face:unknown)=>faces.add(face),delete:(face:unknown)=>faces.delete(face)}};
(globalThis as any).FontFace=class {family:string;constructor(family:string){this.family=family;}load(){loads++;return new Promise(resolve=>pending.push(()=>resolve(this)));}};
globalThis.fetch=async()=>new Response(JSON.stringify({ok:true,data:{items:[{id:'font',family:'Family',data:'data:font/woff2;base64,d09GMg==',version:1}]}}),{headers:{'content-type':'application/json'}});
const m={exports:{} as any};new Function('module','exports',b.outputFiles[0].text)(m,m.exports);const load=m.exports.loadFontResources;
const first=load();await new Promise(r=>setTimeout(r,0));assert.equal(loads,1);const second=load();await new Promise(r=>setTimeout(r,0));assert.equal(loads,2);pending.shift()!();await first;assert.equal(faces.size,0);pending.shift()!();await second;assert.equal(faces.size,1);await load();assert.equal(loads,2);assert.equal(faces.size,1);console.log('font resources: overlapping consumers retain final FontFace, loaded cache skips completed work');
