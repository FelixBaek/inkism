import assert from 'node:assert/strict';
import {test} from 'node:test';
import katex from 'katex';
import {mathDiagnostic} from '../src/lib/math-diagnostics.ts';
test('KaTeX parser positions select the offending command after Unicode and newlines',()=>{
 const source='한글😀\n x + \\unknownInkism{a}';
 try{katex.renderToString(source,{throwOnError:true,strict:'ignore'});assert.fail('must reject invalid command');}catch(error){const result=mathDiagnostic(error,source);assert.equal(result.start,source.indexOf('\\unknownInkism'));assert.equal(source.slice(result.start!,result.end!),'\\unknownInkism');assert.equal(result.line,2);assert.equal(result.column,6);}
});
test('EOF positions and errors without offsets remain truthful',()=>{
 const eof=mathDiagnostic({message:'EOF',position:3,length:0},'abc');assert.equal(eof.start,3);assert.equal(eof.end,3);assert.equal(eof.column,4);
 for(const position of [-1,NaN,Infinity,5,1.2,undefined])assert.equal(mathDiagnostic({message:'bad',position},'abc').start,null);
 assert.equal(mathDiagnostic(null,'').line,null);
});
test('valid common formulas render with safe KaTeX policy',()=>{
 for(const source of ['\\frac{1}{2}','e^{i\\pi}+1=0','\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}','\\int_0^1 x^2 dx'])assert.match(katex.renderToString(source,{throwOnError:true,trust:false,maxExpand:1000,maxSize:20}),/katex/);
});
