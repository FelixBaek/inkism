import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {readdirSync,readFileSync,statSync} from 'node:fs';
import type {Plugin} from 'vite';
/** Ship PDF fonts, CJK maps and image decoders with the app for offline use. */
export function pdfAssets():Plugin{
 const root=dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
 const files=new Map<string,string>();for(const folder of ['cmaps','standard_fonts','wasm'])for(const file of readdirSync(join(root,folder))){const path=join(root,folder,file);if(statSync(path).isFile())files.set(`pdf-assets/${folder}/${file}`,path);}
 return {name:'inkism-pdf-assets',generateBundle(){for(const [fileName,path] of files)this.emitFile({type:'asset',fileName,source:readFileSync(path)});},configureServer(server){server.middlewares.use((request,response,next)=>{const path=files.get((request.url??'').split('?')[0].replace(/^\//,''));if(!path)return next();response.setHeader('Content-Type',path.endsWith('.wasm')?'application/wasm':path.endsWith('.js')?'text/javascript':'application/octet-stream');response.end(readFileSync(path));});}};
}
