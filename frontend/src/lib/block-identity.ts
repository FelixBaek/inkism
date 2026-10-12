import {Fragment,type Node,Slice} from '@tiptap/pm/model';
export const newBlockId=()=>`ink-block-${crypto.randomUUID()}`;
export function cloneBlockIdentity(node:Node):Node {
 if(node.isText)return node;
 const children:Node[]=[];node.forEach(child=>children.push(cloneBlockIdentity(child)));
 return node.type.create(node.attrs.id?{...node.attrs,id:newBlockId()}:node.attrs,Fragment.fromArray(children),node.marks);
}
export function cloneSliceIdentity(slice:Slice):Slice {
 const nodes:Node[]=[];slice.content.forEach(node=>nodes.push(cloneBlockIdentity(node)));
 return new Slice(Fragment.fromArray(nodes),slice.openStart,slice.openEnd);
}
/** Rewrite attributes only, preserving every other source byte in a duplicated block. */
export function cloneHTMLIdentity(html:string):string {
 if(!/\bid\s*=/i.test(html))return html;
 return html.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[a-zA-Z][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>/g,tag=>{
  if(!/^<[a-z]/i.test(tag))return tag;
  return tag.replace(/(\s)([\w:-]+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/g,(all,space,name,eq)=>name.toLowerCase()==='id'?`${space}${name}${eq}"${newBlockId()}"`:all);
 });
}
/** Explicit preparation: add missing block IDs without normalizing any other byte.
 * Existing IDs (including ambiguous imported duplicates) are never redirected. */
export function prepareHTMLBlockIdentity(html:string):string {
 const blocks=new Set(['p','h1','h2','h3','h4','h5','h6','blockquote','ul','ol','li','pre','hr','table','tr','td','th','details','summary','img']);
 return html.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<(script|style|textarea|title)\b[^>]*>[\s\S]*?<\/\1\s*>|<[a-zA-Z][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>/gi,tag=>{
  const name=/^<([a-z][\w:-]*)\b/i.exec(tag)?.[1].toLowerCase();
  if(!name||!blocks.has(name))return tag;
  const attrs=Array.from(tag.matchAll(/\s([\w:-]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g));
  if(attrs.some(a=>a[1].toLowerCase()==='id'))return tag;
  return tag.replace(/\s*\/?>(?=$)/,ending=>` id="${newBlockId()}"${ending}`);
 });
}
