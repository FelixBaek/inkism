import assert from 'node:assert/strict';
import {build} from 'esbuild';
const result=await build({entryPoints:['frontend/src/lib/block-heights.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {BlockHeights}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const heights=new BlockHeights();heights.resize(100000);
assert.equal(heights.top(100000),4800000);
heights.set(0,1000);heights.set(31,12);heights.set(99999,240);
assert.equal(heights.top(32),32*48+952-36);
for(const index of [0,1,31,32,50000,99999]){
 assert.equal(heights.at(heights.top(index)),index);
 assert.equal(heights.at(heights.top(index+1)-0.1),index);
}
heights.resize(100001,32);assert.equal(heights.top(32),32*48+952-36);
assert.equal(heights.top(100001),100001*48+952-36);
heights.clear();assert.equal(heights.top(100001),100001*48);
for(const count of [0,1,2,3,31,32,33,97,1023]){
 const sparse=new BlockHeights();sparse.resize(count);
 let size=count;
 for(let index=0;index<count;index+=3)sparse.set(index,1+(index*17%113)/10);
 const check=()=>{
  const starts=Array.from({length:size+1},(_,index)=>sparse.top(index));
  for(const pixel of [-1,0,Infinity,NaN,...starts.flatMap(top=>[top-0.001,top,top+0.001])]){
   let expected=0;
   while(expected<size&&starts[expected+1]<=pixel)expected++;
   expected=Math.min(Math.max(0,size-1),expected);
   assert.equal(sparse.at(pixel),expected,`count=${size}, pixel=${pixel}`);
  }
 };
 check();
 size=count+7;sparse.resize(size,Math.floor(count/2));check();
 sparse.clear();check();
}
console.log('PASS: measured prefix positions, pixel lookup, structural invalidation and width reset');
