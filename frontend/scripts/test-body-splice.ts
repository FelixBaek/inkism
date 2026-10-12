// Node 22+: node --experimental-strip-types frontend/scripts/test-body-splice.ts
import assert from 'node:assert/strict';
import {bodySplice} from '../src/lib/body-splice.ts';
const values=['','한글','😀','😁','🀀','a😀한글z','a😁한글z','\n<p>앞😀</p>'];
for(const before of values) for(const after of values) {
 const d=bodySplice(before,after), bytes=Buffer.from(before), end=d.start+Buffer.byteLength(d.expected);
 assert.equal(bytes.subarray(d.start,end).toString(),d.expected);
 assert.equal(Buffer.concat([bytes.subarray(0,d.start),Buffer.from(d.replacement),bytes.subarray(end)]).toString(),after);
}
console.log('PASS: UTF-8 insertion/deletion/replacement including shared emoji surrogates');
