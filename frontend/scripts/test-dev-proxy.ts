import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:5173';
for(const [origin,site,expected] of [
  [base,'same-origin',200],
  ['https://foreign.example','cross-site',403],
  ['https://foreign.example','same-origin',403],
  ['null','same-origin',403],
  [base,'cross-site',403],
] as [string,string,number][]) {
  const response=await fetch(base+'/api/rpc',{
    method:'POST',headers:{'Content-Type':'application/json',Origin:origin,'Sec-Fetch-Site':site},
    body:JSON.stringify({op:'health'}),signal:AbortSignal.timeout(5000),
  });
  assert.equal(response.status,expected,`${origin} ${site}: ${await response.text()}`);
}
console.log('PASS: same-origin development proxy works; foreign, malformed and cross-site requests remain blocked');
