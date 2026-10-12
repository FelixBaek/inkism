import {rpc} from '../api';
import {t} from '../i18n';
export type WhiteboardKind='pen'|'rectangle'|'ellipse'|'line'|'arrow';
export type WhiteboardPoint={x:number;y:number};
export type WhiteboardShape={id:string;kind:WhiteboardKind;x:number;y:number;width:number;height:number;color:string;stroke:number;points:WhiteboardPoint[]};
export type WhiteboardState={version:1;shapes:WhiteboardShape[]};
export const emptyWhiteboard=():WhiteboardState=>({version:1,shapes:[]});
const finite=(x:unknown)=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<=100000;
export function parseWhiteboard(value:unknown):WhiteboardState{
 const fail=()=>{throw new Error(t('화이트보드 파일의 형식이나 크기를 확인해 주세요.'));};
 if(!value||typeof value!=='object'||JSON.stringify(value).length>8*1024*1024)fail();const data=value as WhiteboardState;
 if(data.version!==1||!Array.isArray(data.shapes)||data.shapes.length>1000)fail();const ids=new Set<string>();let points=0;
 for(const shape of data.shapes){if(!shape||typeof shape.id!=='string'||!/^[\w-]{1,100}$/.test(shape.id)||ids.has(shape.id)||!['pen','rectangle','ellipse','line','arrow'].includes(shape.kind)||!['x','y','width','height'].every(k=>finite(shape[k as 'x']))||shape.width<1||shape.height<1||!/^#[0-9a-f]{6}$/i.test(shape.color)||!finite(shape.stroke)||shape.stroke<1||shape.stroke>40||!Array.isArray(shape.points))fail();ids.add(shape.id);points+=shape.points.length;if(points>20000)fail();for(const p of shape.points)if(!p||!finite(p.x)||!finite(p.y)||p.x<0||p.x>1||p.y<0||p.y>1)fail();if(['line','arrow'].includes(shape.kind)&&shape.points.length!==2)fail();if(shape.kind==='pen'&&shape.points.length<1)fail();}
 return {version:1,shapes:data.shapes.map(s=>({id:s.id,kind:s.kind,x:s.x,y:s.y,width:s.width,height:s.height,color:s.color,stroke:s.stroke,points:s.points.map(p=>({x:p.x,y:p.y}))}))};
}
export function shapeFromPoints(kind:WhiteboardKind,points:WhiteboardPoint[],color:string,stroke:number):WhiteboardShape{
 const xs=points.map(p=>p.x),ys=points.map(p=>p.y),x=Math.min(...xs),y=Math.min(...ys),width=Math.max(1,Math.max(...xs)-x),height=Math.max(1,Math.max(...ys)-y);
 return {id:crypto.randomUUID(),kind,x,y,width,height,color,stroke,points:points.map(p=>({x:(p.x-x)/width,y:(p.y-y)/height}))};
}
export function whiteboardShapeSVG(s:WhiteboardShape):string{
 const attributes=`fill="none" stroke="${s.color}" stroke-width="${s.stroke}" stroke-linecap="round" stroke-linejoin="round"`;
 if(s.kind==='rectangle')return `<rect x="${s.x}" y="${s.y}" width="${s.width}" height="${s.height}" ${attributes}/>`;
 if(s.kind==='ellipse')return `<ellipse cx="${s.x+s.width/2}" cy="${s.y+s.height/2}" rx="${s.width/2}" ry="${s.height/2}" ${attributes}/>`;
 const p=s.points.map(p=>({x:s.x+p.x*s.width,y:s.y+p.y*s.height}));let d=p.map((p,i)=>`${i?'L':'M'}${p.x},${p.y}`).join(' ');if(p.length===1)d+=` L${p[0].x+.01},${p[0].y}`;
 if(s.kind==='arrow'){const a=p[0],b=p[1],angle=Math.atan2(b.y-a.y,b.x-a.x),length=Math.max(12,s.stroke*3);d+=` M${b.x-length*Math.cos(angle-.5)},${b.y-length*Math.sin(angle-.5)} L${b.x},${b.y} L${b.x-length*Math.cos(angle+.5)},${b.y-length*Math.sin(angle+.5)}`;}
 return `<path d="${d}" ${attributes}/>`;
}
export function whiteboardSVG(value:WhiteboardState):string{const state=parseWhiteboard(value);const minX=Math.min(0,...state.shapes.map(s=>s.x-25)),minY=Math.min(0,...state.shapes.map(s=>s.y-25)),maxX=Math.max(100,...state.shapes.map(s=>s.x+s.width+25)),maxY=Math.max(100,...state.shapes.map(s=>s.y+s.height+25));return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${maxX-minX} ${maxY-minY}">${state.shapes.map(whiteboardShapeSVG).join('')}</svg>`;}
export async function loadWhiteboard(){const result=await rpc<{whiteboard:{value:unknown;updated_at:number}}>('workspace_tools_get');return {state:result.whiteboard.value?parseWhiteboard(result.whiteboard.value):emptyWhiteboard(),version:result.whiteboard.updated_at};}
export async function saveWhiteboard(state:WhiteboardState,version:number){const result=await rpc<{whiteboard:{updated_at:number}}>('workspace_tools_set',{whiteboard:parseWhiteboard(state),expected_updated_at:{workspace_whiteboard:version}});return result.whiteboard.updated_at;}
