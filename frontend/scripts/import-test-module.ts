import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

// Keep editor packages external so the test and cache share the same class/plugin
// instances. Place the temporary bundle beside scripts for node_modules resolution.
export async function importTestModule(source) {
 // API bridge registers browser events at import; these pure cache tests never call RPC.
 (globalThis as any).window ??= new EventTarget();
 const dir=await mkdtemp(fileURLToPath(new URL('.test-bundle-',import.meta.url)));
 try {
  const outfile=join(dir,'module.mjs');
  await build({entryPoints:[fileURLToPath(source)],outfile,bundle:true,packages:'external',platform:'node',format:'esm'});
  return await import(pathToFileURL(outfile).href);
 } finally {await rm(dir,{recursive:true,force:true});}
}
