import { rpc } from '../api';

export type PropertyType = 'text' | 'number' | 'date' | 'checkbox' | 'list' | 'select' | 'multiselect' | 'person' | 'relation' | 'attachment';
export type NoteProperty = { definition_id?: string; name: string; type: PropertyType; value: string | number | boolean | string[]; options?: string[] };
export type DocumentSettings = {cover?: import("../types").NotebookCover | null; parent_id?: string | null; width?: "standard"|"wide"|"full"; spacing?: "compact"|"normal"|"relaxed"; tone?: "default"|"paper"|"soft"; card_size?: "small"|"medium"|"large"; card_shadow?: boolean};
export type NoteKnowledge = { anchor_redirects?:Record<string,string>; id: string; aliases: string[]; properties: NoteProperty[]; version: number; document?: DocumentSettings };
export type KnowledgeItem = NoteKnowledge & { title: string; tags: string[]; updated_at: number; revision: number; readonly: boolean; content_format: string };
export type PropertyDefinition = {id:string;name:string;type:PropertyType;options?:string[]};
export type StylePreset = {id:string;name:string;style:Omit<DocumentSettings,"parent_id">};
export type BlockStyle = {id:string;name:string;type:"paragraph"|"heading"|"blockquote"|"callout"|"codeBlock";attrs:{textAlign?:"left"|"center"|"right"|"justify";dir?:"ltr"|"rtl"}};
export type SavedView = {
  card?: {cover_property?:string; visible_properties?:string[]};
  formulas?: {id:string;name:string;expression:string}[]; aggregate?:{operation:"count"|"sum"|"average"|"min"|"max";property:string};
  id: string; name: string; layout: 'table' | 'cards' | 'kanban';
  filters?: SavedView['filter'][]; filter_mode?: 'all'|'any'; group_by?: string;
  filter: { property: string; operator: 'contains' | 'equals' | 'gt' | 'lt' | 'exists'; value: string };
  sort: { property: string; direction: 'asc' | 'desc' };
};
export type KnowledgeSettings = { glossary?:import("./term-glossary").TermGlossaryEntry[]; style_presets?:StylePreset[]; property_definitions?:PropertyDefinition[]; block_styles?:BlockStyle[]; version: number; template_ids: string[]; daily_template_id: string | null; views: SavedView[] };
export type GraphNode = { id: string; title: string; tags: string[]; aliases: string[] };
export type GraphEdge = { source: string; target: string };
export type RelationKind = 'link' | 'title_link' | 'relation' | 'parent';
/** One typed edge from the engine `relations` op; `direction` is relative to `from`. */
export type RelationEdge = { source: string; target: string; source_title: string; target_title: string; kind: RelationKind; property: string | null; direction: 'out' | 'in'; from: string; hop: number; evidence: { label?: string; byte_offset?: number; byte_end?: number; property?: string } | null };
export type RelationQuery = { id: string; depth?: 1 | 2; kinds?: ('link' | 'relation' | 'parent')[]; property?: string; direction?: 'out' | 'in' | 'both'; limit?: number };
export type GraphData = { nodes: GraphNode[]; edges: GraphEdge[]; truncated: boolean };
export const knowledge = {
  get: (id: string) => rpc<NoteKnowledge>('knowledge_get', { id }),
  set: (value: NoteKnowledge, revision: number) => rpc<NoteKnowledge>('knowledge_set', { ...value, revision }),
  list: () => rpc<{items: KnowledgeItem[]; truncated: boolean}>('knowledge_list'),
  graph: () => rpc<GraphData>('graph_get'),
  relations: (query: RelationQuery, signal?: AbortSignal) => rpc<{ items: RelationEdge[]; truncated: boolean }>('relations', query, { signal }),
  resolve: (target: string) => rpc<{items: {id: string; title: string}[]; ambiguous: boolean;redirect_sources?:string[]}>('link_resolve', {target}),
  settings: () => rpc<KnowledgeSettings>('knowledge_settings_get'),
  saveSettings: (settings: KnowledgeSettings & {collection_update?:{operation:"save"|"apply"|"remove";definition:PropertyDefinition;notes:{id:string;revision:number;version:number}[];value?:NoteProperty["value"]}}) => rpc<KnowledgeSettings>('knowledge_settings_set', settings),
};
export function displayProperty(value: NoteProperty['value'] | undefined): string {
  return value === undefined ? '' : Array.isArray(value) ? value.join(', ') : String(value);
}
export function propertyValue(note: KnowledgeItem, name: string): NoteProperty['value'] | undefined {
  if (name === '$title') return note.title;
  if (name === '$tag') return note.tags;
  if (name === '$updated') return note.updated_at;
  return note.properties.find(p => p.name === name)?.value;
}
export function filterView(notes: KnowledgeItem[], view: SavedView): KnowledgeItem[] {
  const matches = (note: KnowledgeItem, {property, operator, value}: SavedView["filter"]) => {
    if (!property) return true;
    const actual = propertyValue(note, property);
    if (operator === 'exists') return actual !== undefined;
    if (actual === undefined) return false;
    if (operator === 'gt' || operator === 'lt') {
      if (typeof actual !== 'number' || value.trim() === '' || !Number.isFinite(Number(value))) return false;
      return operator === 'gt' ? actual > Number(value) : actual < Number(value);
    }
    const normalized = value.toLocaleLowerCase();
    if (operator === 'equals') return Array.isArray(actual)
      ? actual.some(x => x.toLocaleLowerCase() === normalized)
      : String(actual).toLocaleLowerCase() === normalized;
    return displayProperty(actual).toLocaleLowerCase().includes(normalized);
  };
  const filters=[view.filter,...(view.filters??[])].filter(f=>f.property);
  const result=notes.filter(note=>!filters.length||(view.filter_mode==='any'?filters.some(f=>matches(note,f)):filters.every(f=>matches(note,f))));
  return result.sort((a,b) => {
    const x = propertyValue(a, view.sort.property), y = propertyValue(b, view.sort.property);
    // Missing values stay at the end, in either direction.
    if (x === undefined || y === undefined) return x === y ? a.id.localeCompare(b.id) : x === undefined ? 1 : -1;
    const n = typeof x === 'number' && typeof y === 'number' ? x-y : displayProperty(x).localeCompare(displayProperty(y), undefined, {numeric:true});
    return n * (view.sort.direction === 'asc' ? 1 : -1) || a.id.localeCompare(b.id);
  });
}
/** Each note occurs in one lane; multi-value properties use a combined group. */
export function groupView(notes: KnowledgeItem[], property: string): {key:string; label:string; items:KnowledgeItem[]}[] {
  if (!property) return [{key:'all',label:'',items:notes}];
  const groups=new Map<string,{key:string;label:string;items:KnowledgeItem[]}>();
  for(const note of notes){
    const value=propertyValue(note,property);
    const normalized=Array.isArray(value)?[...value].sort((a,b)=>String(a)<String(b)?-1:String(a)>String(b)?1:0):value;
    const key=normalized===undefined||normalized===''||(Array.isArray(normalized)&&!normalized.length)?'missing':JSON.stringify(normalized);
    if(!groups.has(key))groups.set(key,{key,label:displayProperty(normalized),items:[]});
    groups.get(key)!.items.push(note);
  }
  return [...groups.values()].sort((a,b)=>a.key==='missing'?1:b.key==='missing'?-1:a.label.localeCompare(b.label));
}
export const arrayProperty = (type: PropertyType) => ['list','multiselect','person','relation'].includes(type);
export const initialPropertyValue = (type: PropertyType): NoteProperty['value'] => type==='number'?0:type==='checkbox'?false:arrayProperty(type)?[]:'';
export function graphNeighborhood(data: GraphData, root: string, depth: number): Set<string> {
  const visited = new Set<string>([root]), neighbors = new Map<string,string[]>();
  for (const {source,target} of data.edges) {
    neighbors.set(source, [...(neighbors.get(source) ?? []),target]);
    neighbors.set(target, [...(neighbors.get(target) ?? []),source]);
  }
  let frontier = [root];
  for (let i=0; i<Math.min(3,Math.max(0,depth)); i++) {
    const next: string[] = [];
    for (const id of frontier) for (const other of neighbors.get(id) ?? []) if (!visited.has(other)) {visited.add(other);next.push(other);}
    frontier = next;
  }
  return visited;
}
/** Bounded, deterministic force layout: no timer or background work after close. */
export function graphLayout(nodes: GraphNode[], edges: GraphEdge[]) {
  const positions = nodes.map((node,i) => ({...node,x:400+250*Math.cos(i*2*Math.PI/nodes.length),y:280+210*Math.sin(i*2*Math.PI/nodes.length)}));
  const index = new Map(positions.map((n,i)=>[n.id,i]));
  for(let tick=0; tick<65; tick++) {
    const forces = positions.map(p=>({x:(400-p.x)*.008,y:(280-p.y)*.008}));
    for(let i=0;i<positions.length;i++) for(let j=i+1;j<positions.length;j++) {
      const dx=positions[i].x-positions[j].x,dy=positions[i].y-positions[j].y,d2=Math.max(25,dx*dx+dy*dy);
      const f=1400/d2;
      forces[i].x+=dx*f;forces[i].y+=dy*f;forces[j].x-=dx*f;forces[j].y-=dy*f;
    }
    for(const e of edges) {
      const i=index.get(e.source),j=index.get(e.target);if(i===undefined||j===undefined||i===j)continue;
      const dx=positions[j].x-positions[i].x,dy=positions[j].y-positions[i].y;
      forces[i].x+=dx*.035;forces[i].y+=dy*.035;forces[j].x-=dx*.035;forces[j].y-=dy*.035;
    }
    positions.forEach((p,i)=>{p.x=Math.max(40,Math.min(760,p.x+Math.max(-10,Math.min(10,forces[i].x))));p.y=Math.max(35,Math.min(525,p.y+Math.max(-10,Math.min(10,forces[i].y))));});
  }
  return positions;
}
export type NoteReference = {target: string; anchor: string; label: string; embed: boolean};
export function parseReference(raw: string, embed = false): NoteReference {
  const [destination,...labels] = raw.split('|');
  const hash = destination.indexOf('#');
  return {target:(hash<0?destination:destination.slice(0,hash)).trim().replace(/^note:\/\//,''),anchor:hash<0?'':destination.slice(hash+1).trim(),label:labels.join('|').trim()||destination.trim(),embed};
}
/** Code examples are never treated as live references. HTML anchor links are added by the caller. */
export function wikiReferences(source: string): NoteReference[] {
  const text = source.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm,'').replace(/`+[^`]*`+/g,'');
  return Array.from(text.matchAll(/(!?)\[\[([^\]\n]+)\]\]/g), m=>parseReference(m[2],m[1]==='!'));
}
