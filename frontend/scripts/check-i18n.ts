// Every statically known t(...) key must keep its placeholders in every locale.
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import ts from 'typescript';
const src=new URL('../src/',import.meta.url).pathname;
const files=(d:string):string[]=>readdirSync(d).flatMap(f=>{const p=join(d,f);return statSync(p).isDirectory()?files(p):/\.tsx?$/.test(f)?[p]:[];});
const keys=new Set<string>();
function translations(expression:ts.Expression):void {
  if(ts.isStringLiteral(expression)||ts.isNoSubstitutionTemplateLiteral(expression))keys.add(expression.text);
  else if(ts.isConditionalExpression(expression)){translations(expression.whenTrue);translations(expression.whenFalse);}
  else if(ts.isParenthesizedExpression(expression)||ts.isAsExpression(expression)||ts.isSatisfiesExpression(expression))translations(expression.expression);
  else if(ts.isElementAccessExpression(expression)&&ts.isArrayLiteralExpression(expression.expression)){
    for(const element of expression.expression.elements)if(ts.isExpression(element))translations(element);
  }
}
for(const file of files(src)){
  const ast=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  const visit=(node:ts.Node):void=>{if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='t'&&node.arguments[0])translations(node.arguments[0]);ts.forEachChild(node,visit);};
  visit(ast);
}
const holes=(s:string)=>[...s.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort().join();
let bad=0;
for(const lang of ['en','zh','ja']){
  const dict=JSON.parse(readFileSync(join(src,'locales',lang+'.json'),'utf8'));
  for(const k of keys){
    if(!(k in dict)){console.error(lang+' missing: '+k);bad++;}
    else if(holes(k)!==holes(dict[k])){console.error(lang+' placeholder mismatch: '+k+' -> '+dict[k]);bad++;}
  }
}
if(bad)process.exit(1);
console.log('PASS: '+keys.size+' keys translated in en, zh, ja');
