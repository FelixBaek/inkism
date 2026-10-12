// Node 22+: node --experimental-strip-types frontend/scripts/test-canvas-board.ts
import assert from "node:assert/strict";
import { createFileCard, createWebCard, emptyCanvas, exportJsonCanvas, importJsonCanvas, parseCanvas, safeCanvasUrl } from "../src/lib/canvas-board.ts";

assert.equal(safeCanvasUrl("javascript:alert(1)"), undefined);
assert.equal(safeCanvasUrl("https://example.com/a"), "https://example.com/a");
const state = { ...emptyCanvas(), nodes: [createFileCard({ name: "photo.png", size: 42, type: "image/png" }), createWebCard("https://example.com", 1)] };
const roundTrip = importJsonCanvas(exportJsonCanvas(state));
assert.equal(roundTrip.nodes.length, 2);
assert.equal(roundTrip.nodes[0].kind, "file");
assert.equal(roundTrip.nodes[0].attachmentId, state.nodes[0].attachmentId);
assert.equal(roundTrip.nodes[1].kind, "web");
assert.equal(roundTrip.nodes[1].url, "https://example.com/");
const stored = parseCanvas(JSON.stringify({ version: 1, nodes: [{ id: "f", kind: "file", x: 0, y: 0, width: 220, height: 130, attachmentId: state.nodes[0].attachmentId, url: `/api/attachments/${state.nodes[0].attachmentId}?preview=1` }], edges: [] }));
assert.match(stored.nodes[0].url || "", /^\/api\/attachments\//);
assert.equal(importJsonCanvas(JSON.stringify({ nodes: [{ id: "x", type: "link", url: "javascript:bad", x: 0, y: 0, width: 100, height: 100 }] })).nodes.length, 0);
console.log("PASS: Canvas file/web cards, safe URLs, and JSON Canvas round-trip");

const {createGroupCard,canvasMoveIds,moveCanvasNodes,canvasBackgroundUrl,canvasImportWarnings}=await import('../src/lib/canvas-board.ts');
const fixture={nodes:[{id:'g',type:'group',x:0,y:0,width:500,height:400,label:'Research',background:'assets/grid.png',backgroundStyle:'repeat',color:'3'},{id:'nested',type:'group',x:20,y:60,width:250,height:200,label:'Nested'},{id:'inside',type:'text',x:40,y:100,width:120,height:80,text:'child'},{id:'partial',type:'text',x:450,y:100,width:120,height:80,text:'partial'},{id:'outside',type:'link',x:900,y:0,width:220,height:130,url:'https://example.com/'}],edges:[{id:'e',fromNode:'g',toNode:'inside'}]};
const groups=importJsonCanvas(JSON.stringify(fixture));
assert.deepEqual(JSON.parse(exportJsonCanvas(groups)),fixture,'all group fields, dimensions, edges and z-order round-trip');
assert.deepEqual(canvasImportWarnings(JSON.stringify(fixture)),[]);
assert.equal(exportJsonCanvas(parseCanvas(JSON.stringify(groups))),exportJsonCanvas(groups),'persistent state restores groups');
const ids=canvasMoveIds(groups,'g');assert.deepEqual(ids,['g','nested','inside']);
const moved=moveCanvasNodes(groups,ids,600,10);assert.equal(moved.nodes[2].x,640);assert.equal(moved.nodes[3].x,450);assert.equal(moved.nodes[4].x,900);
assert.equal(createGroupCard([groups.nodes[2]]).x,10);
assert.equal(canvasBackgroundUrl('https://evil.example/image'),undefined);assert.equal(canvasBackgroundUrl('../secret'),undefined);
assert.equal(canvasBackgroundUrl('00000000-0000-4000-8000-000000000001'),'/api/attachments/00000000-0000-4000-8000-000000000001?preview=1');
console.log('PASS: JSON Canvas groups, nested containment, fixed gesture membership, z-order and safe background round-trip');
