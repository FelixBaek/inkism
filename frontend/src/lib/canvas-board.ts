/** Persistent, source independent canvas model. Notes remain canonical in SQLite;
 * this model only stores layout and edges, so moving a card never edits a note. */
export type CanvasNode = {
  id: string;
  kind: "note" | "text" | "file" | "web" | "group";
  x: number;
  y: number;
  width: number;
  height: number;
  noteId?: string;
  title?: string;
  text?: string;
  color?: string;
  /** Stable attachment identity; the binary itself remains in the attachment store. */
  attachmentId?: string;
  mime?: string;
  url?: string;
  offline?: boolean;
  label?: string;
  background?: string;
  backgroundStyle?: "cover" | "ratio" | "repeat";
};

export type CanvasEdge = { id: string; from: string; to: string; label?: string; fromSide?: string; toSide?: string; fromEnd?: string; toEnd?: string; color?: string };
export type CanvasState = { version: 1; nodes: CanvasNode[]; edges: CanvasEdge[] };

export const emptyCanvas = (): CanvasState => ({ version: 1, nodes: [], edges: [] });
const id = () => `canvas-${crypto.randomUUID()}`;

export function createNoteCard(note: { id: string; title: string }, index = 0): CanvasNode {
  return { id: id(), kind: "note", noteId: note.id, title: note.title, x: 80 + (index % 4) * 260, y: 80 + Math.floor(index / 4) * 180, width: 220, height: 130 };
}
export function createTextCard(text = "", index = 0): CanvasNode {
  return { id: id(), kind: "text", text, title: "텍스트 카드", x: 80 + (index % 4) * 260, y: 80 + Math.floor(index / 4) * 180, width: 220, height: 130 };
}
export function createFileCard(file: { name: string; size?: number; lastModified?: number; type?: string; attachmentId?: string; previewUrl?: string }, index = 0): CanvasNode {
  const attachmentId = file.attachmentId || `local:${file.name}:${file.size || 0}:${file.lastModified || 0}`;
  return { id: id(), kind: "file", attachmentId, mime: file.type || "application/octet-stream", url: file.previewUrl, title: file.name.slice(0, 240), text: `${file.size || 0} bytes`, offline: !file.previewUrl, x: 80 + (index % 4) * 260, y: 80 + Math.floor(index / 4) * 180, width: 220, height: 130 };
}
export function createWebCard(url: string, index = 0): CanvasNode {
  const safe = safeCanvasUrl(url);
  return { id: id(), kind: "web", url: safe, title: safe ? new URL(safe).hostname : "웹 카드", offline: false, x: 80 + (index % 4) * 260, y: 80 + Math.floor(index / 4) * 180, width: 220, height: 130 };
}
/** Only network URLs which can be opened by the preview are accepted. */
export function safeCanvasUrl(value: string): string | undefined {
  try { const u = new URL(value.trim()); return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : undefined; } catch { return undefined; }
}
export function connect(state: CanvasState, from: string, to: string, label?: string): CanvasState {
  if (from === to || !state.nodes.some(n => n.id === from) || !state.nodes.some(n => n.id === to)) return state;
  if (state.edges.some(e => e.from === from && e.to === to)) return state;
  return { ...state, edges: [...state.edges, { id: id(), from, to, label }] };
}
export function parseCanvas(raw: string | null): CanvasState {
  if (!raw) return emptyCanvas();
  try {
    const v = JSON.parse(raw) as Partial<CanvasState>;
    if (v.version !== 1 || !Array.isArray(v.nodes) || !Array.isArray(v.edges)) return emptyCanvas();
    const nodes = v.nodes.filter(n => n && typeof n.id === "string" && ["note", "text", "file", "web", "group"].includes(n.kind as string) && Number.isFinite(n.x) && Number.isFinite(n.y)).map(n => ({...n, url: n.kind === "web" ? safeCanvasUrl(n.url || "") : n.kind === "file" && typeof n.url === "string" && n.url.startsWith("/api/attachments/") ? n.url : undefined}));
    const ids = new Set(nodes.map(n => n.id));
    const edges = v.edges.filter(e => e && typeof e.id === "string" && ids.has(e.from) && ids.has(e.to));
    return { version: 1, nodes, edges } as CanvasState;
  } catch { return emptyCanvas(); }
}
/** Import/export the interoperable JSON Canvas 1.0 shape. */
export function exportJsonCanvas(state: CanvasState): string {
  return JSON.stringify({ nodes: state.nodes.map(n => n.kind === "group" ? {id:n.id,type:"group",x:n.x,y:n.y,width:n.width,height:n.height,color:n.color,label:n.label,background:n.background,backgroundStyle:n.backgroundStyle} : n.kind === "note" ? { id: n.id, type: "file", file: n.noteId || "", inkismKind: "note", x:n.x, y:n.y, width:n.width, height:n.height, color:n.color } : n.kind === "text" ? { id:n.id, type:"text", text:n.text || "", x:n.x, y:n.y, width:n.width, height:n.height, color:n.color } : n.kind === "web" ? { id:n.id, type:"link", url:n.url || "", x:n.x, y:n.y, width:n.width, height:n.height, color:n.color } : { id:n.id, type:"file", file:n.attachmentId || n.title || "", x:n.x, y:n.y, width:n.width, height:n.height, color:n.color }), edges: state.edges.map(e => ({ id:e.id, fromNode:e.from, toNode:e.to, label:e.label, fromSide:e.fromSide, toSide:e.toSide, fromEnd:e.fromEnd, toEnd:e.toEnd, color:e.color })) }, null, 2);
}
export function importJsonCanvas(raw: string): CanvasState {
  try {
    const value = JSON.parse(raw) as {nodes?: unknown[]; edges?: unknown[]};
    if (!Array.isArray(value.nodes)) return emptyCanvas();
    const nodes: CanvasNode[] = value.nodes.flatMap((v): CanvasNode[] => { const n = v as Record<string, unknown>; if (typeof n.id !== "string" || !["text","file","link","group"].includes(String(n.type))) return []; const base = {id:n.id,x:Number(n.x)||0,y:Number(n.y)||0,width:Math.max(1,Number(n.width)||220),height:Math.max(1,Number(n.height)||130),color:typeof n.color === "string" ? n.color : undefined}; if(n.type === "group") return [{...base,kind:"group",label:typeof n.label === "string" ? n.label : undefined,background:typeof n.background === "string" ? n.background : undefined,backgroundStyle:["cover","ratio","repeat"].includes(String(n.backgroundStyle)) ? n.backgroundStyle as CanvasNode["backgroundStyle"] : undefined}]; if(n.type === "text") return [{...base,kind:"text",text:typeof n.text === "string" ? n.text : "",title:"텍스트 카드"}]; if(n.type === "link"){const url=safeCanvasUrl(typeof n.url === "string" ? n.url : "");return url ? [{...base,kind:"web",url,title:new URL(url).hostname}] : [];} if(n.inkismKind === "note") return [{...base,kind:"note",noteId:typeof n.file === "string" ? n.file : undefined,title:typeof n.file === "string" ? n.file : "노트 카드"}]; return [{...base,kind:"file",attachmentId:typeof n.file === "string" ? n.file : undefined,title:typeof n.file === "string" ? n.file : "파일 카드",offline:true}]; });
    const ids = new Set(nodes.map(n=>n.id)); const edges = Array.isArray(value.edges) ? value.edges.flatMap(v=>{const e=v as Record<string,unknown>;return typeof e.id === "string" && typeof e.fromNode === "string" && typeof e.toNode === "string" && ids.has(e.fromNode) && ids.has(e.toNode) ? [{id:e.id,from:e.fromNode,to:e.toNode,label:typeof e.label === "string" ? e.label : undefined,fromSide:typeof e.fromSide === "string" ? e.fromSide : undefined,toSide:typeof e.toSide === "string" ? e.toSide : undefined,fromEnd:typeof e.fromEnd === "string" ? e.fromEnd : undefined,toEnd:typeof e.toEnd === "string" ? e.toEnd : undefined,color:typeof e.color === "string" ? e.color : undefined}] : [];}) : [];
    return {version:1,nodes,edges};
  } catch { return emptyCanvas(); }
}
export function canvasImportWarnings(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as { nodes?: unknown[]; edges?: unknown[]; [key: string]: unknown };
    const warnings: string[] = [];
    const allowed = new Set(["nodes", "edges"]);
    for (const key of Object.keys(value)) if (!allowed.has(key)) warnings.push(`알 수 없는 JSON Canvas 필드가 무시되었습니다: ${key}`);
    if (!Array.isArray(value.nodes)) return ["JSON Canvas에 nodes 배열이 없어 가져오지 않았습니다.", ...warnings];
    for (const node of value.nodes) { const n = node as Record<string, unknown>; if (!n || typeof n !== "object" || !["text", "file", "link", "group"].includes(String(n.type))) { const kind = n && typeof n === "object" ? String(n.type || "알 수 없음") : "알 수 없음"; warnings.push(`지원하지 않는 Canvas 노드가 무시되었습니다: ${kind}`); } else for (const key of Object.keys(n)) if (!["id","type","text","file","url","x","y","width","height","color","inkismKind","label","background","backgroundStyle"].includes(key)) warnings.push(`알 수 없는 노드 필드가 무시되었습니다: ${key}`); }
    if (Array.isArray(value.edges)) for (const edge of value.edges) { const e=edge as Record<string,unknown>; for (const key of Object.keys(e)) if (!["id","fromNode","toNode","label","fromSide","toSide","fromEnd","toEnd","color"].includes(key)) warnings.push(`알 수 없는 연결 필드가 무시되었습니다: ${key}`); }
    return [...new Set(warnings)];
  } catch { return ["JSON Canvas 형식이 올바르지 않아 가져오지 않았습니다."]; }
}
export function loadCanvas(key: string): CanvasState { try { return parseCanvas(localStorage.getItem(key)); } catch { return emptyCanvas(); } }
export function saveCanvas(key: string, state: CanvasState) { try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* private mode */ } }

/** Containment is geometric (JSON Canvas has no parent IDs). Snapshot membership
 * at gesture start so crossing another card while dragging never picks it up. */
export function canvasMoveIds(state: CanvasState, nodeId: string): string[] {
  const group = state.nodes.find(n => n.id === nodeId);
  if (!group || group.kind !== "group") return group ? [nodeId] : [];
  return state.nodes.filter(n => n.id === nodeId || (n.x >= group.x && n.y >= group.y && n.x+n.width <= group.x+group.width && n.y+n.height <= group.y+group.height)).map(n => n.id);
}
export function moveCanvasNodes(state: CanvasState, ids: readonly string[], dx: number, dy: number): CanvasState {
  const moving = new Set(ids);
  return {...state,nodes:state.nodes.map(n => moving.has(n.id) ? {...n,x:n.x+dx,y:n.y+dy} : n)};
}
export function createGroupCard(nodes: CanvasNode[] = []): CanvasNode {
  const x=nodes.length ? Math.min(...nodes.map(n=>n.x))-30 : 50;
  const y=nodes.length ? Math.min(...nodes.map(n=>n.y))-50 : 50;
  return {id:id(),kind:"group",label:"",x,y,width:nodes.length ? Math.max(...nodes.map(n=>n.x+n.width))-x+30 : 540,height:nodes.length ? Math.max(...nodes.map(n=>n.y+n.height))-y+30 : 360};
}
/** Imported paths round-trip, but never become arbitrary network requests. */
export function canvasBackgroundUrl(background?: string): string | undefined {
  return background && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(background) ? `/api/attachments/${background}?preview=1` : undefined;
}
