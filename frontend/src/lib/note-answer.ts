import {sourcePosition,type SearchDocument} from './search-document-core';
import type {SearchHit} from './global-search-core';
import type {Summary} from '../types';
import type {SemanticHit} from '../api';
import type {RelationEdge} from './knowledge';
/** Answers from the user's notes: only passages this module retrieved are sent to the model. */
export type Evidence={n:number;note:Summary;text:string;hit:SearchHit};
export type AnswerPart={text:string;at:number}|{cite:Evidence};

const STOP=new Set(['무엇','뭐','뭐야','뭔가','뭘','어떻게','어떤','왜','언제','어디','누구','알려줘','알려','설명','설명해줘','해줘','정리','정리해줘','내','나','내가','관련','대해','대한','what','how','why','when','where','who','which','is','are','was','the','a','an','of','to','in','on','for','and','or','not','do','does','did','my','me','about','tell']);
// Longest first so '에서' wins over '서'.
const PARTICLES=['이란','이고','이며','이나','하고','에서','으로','이야','이에요','인가요','인가','이다','에게','까지','부터','처럼','란','로','은','는','이','가','을','를','에','의','와','과','도','만','요','야'];

export function keywords(question:string):string[] {
 const out:string[]=[],seen=new Set<string>();
 for(let word of question.split(/[\s?!.,;:()"'“”‘’[\]{}<>/\\|`~*#]+/)){
  // shortcut: particle stripping is a suffix heuristic, not morphology; use a tokenizer if recall suffers.
  for(const p of PARTICLES)if(word.length-p.length>=2&&word.endsWith(p)){word=word.slice(0,-p.length);break;}
  const key=word.toLocaleLowerCase();
  if(word.length<2||STOP.has(key)||/^(and|or|not)$/i.test(word)||seen.has(key))continue;
  seen.add(key);out.push(word);if(out.length===8)break;
 }
 return out;
}

/** FTS candidate query understood by the engine's `list` search (terms joined with OR). */
export const candidateQuery=(words:string[])=>words.join(' OR ');

function occurrences(lower:string,word:string,limit=20){const at:number[]=[];let i=lower.indexOf(word);while(i>=0&&at.length<limit){at.push(i);i=lower.indexOf(word,i+word.length);}return at;}

type Candidate={note:Summary;doc?:SearchDocument;text:string;start:number;end:number;first:number;word:string;score:number};

/** Merged windows around every match in one note, best two first. */
function noteWindows(note:Summary,body:string|SearchDocument,words:string[],lowerWords:string[],radius:number,related=false):Candidate[]{
 const doc=typeof body==='string'?undefined:body,text=typeof body==='string'?body:body.text,lower=text.toLocaleLowerCase();
 const windows:Candidate[]=[];
 const positions=lowerWords.flatMap((word,k)=>occurrences(lower,word).map(at=>({at,k}))).sort((a,b)=>a.at-b.at);
 for(const {at,k} of positions){
  const start=Math.max(0,at-radius),end=Math.min(text.length,at+lowerWords[k].length+radius),prev=windows.at(-1);
  if(prev&&start<=prev.end)prev.end=Math.max(prev.end,end);
  else windows.push({note,doc,text,start,end,first:at,word:words[k],score:0});
 }
 const title=note.title.toLocaleLowerCase(),titleHits=lowerWords.filter(w=>title.includes(w)).length;
 if(!windows.length&&(titleHits||related)&&text.trim())windows.push({note,doc,text,start:0,end:Math.min(text.length,radius*2),first:0,word:'',score:0});
 for(const w of windows){const slice=lower.slice(w.start,w.end);w.score=lowerWords.filter(x=>slice.includes(x)).length*10+titleHits*5+lowerWords.reduce((sum,x)=>sum+occurrences(slice,x).length,0);}
 // A related note reached through a typed relation ranks like a one-word match, so the hop survives the passage budget.
 if(related)for(const w of windows)w.score=Math.max(w.score,10);
 windows.sort((a,b)=>b.score-a.score);
 return windows.slice(0,2);
}

function toEvidence(c:Candidate,n:number,passage:string):Evidence{
 const matched=c.text.slice(c.first,c.first+c.word.length);
 let occurrence=0,at=0;
 while(matched&&at<c.first){
  const next=c.text.indexOf(matched,at);
  if(next<0||next>=c.first)break;
  occurrence++;
  at=next+matched.length;
 }
 const line=c.text.slice(0,c.first).split('\n').length;
 return {n,note:c.note,text:passage,hit:{note:c.note,index:c.first,line,snippet:passage.slice(0,240),matchStart:0,matchLength:0,
  sourceOffset:c.doc?sourcePosition(c.doc,c.first):undefined,sourceEnd:c.doc?sourcePosition(c.doc,c.first+matched.length,true):undefined,revision:c.doc?.revision,matchedText:matched,occurrence}};
}

/** A semantic chunk as an evidence window. Engine offsets index its own plain text, so the chunk is
 * re-found in the loaded document; if it cannot be, the passage is still usable but opens without a jump. */
function semanticCandidate(hit:SemanticHit,body:string|SearchDocument):Candidate{
 const doc=typeof body==='string'?undefined:body,text=typeof body==='string'?body:body.text,snippet=hit.snippet.trim();
 let at=text.slice(hit.start,hit.end).trim()===snippet?text.indexOf(snippet,hit.start):-1;
 const probe=snippet.slice(0,40);
 if(at<0&&probe)at=text.indexOf(probe,Math.max(0,hit.start-2000));
 if(at<0&&probe)at=text.indexOf(probe);
 if(at<0)return {note:hit.note,text:snippet,start:0,end:snippet.length,first:0,word:'',score:hit.score};
 const word=/^[^\n]{1,30}/.exec(text.slice(at))?.[0].trimEnd()??'';
 return {note:hit.note,doc,text,start:at,end:Math.min(text.length,at+snippet.length),first:at,word,score:hit.score};
}

const overlaps=(a:Candidate,b:Candidate)=>a.note.id===b.note.id&&a.start<b.end&&b.start<a.end;

/** Reciprocal Rank Fusion: each ranked list adds 1/(k+rank) to an item's score. */
export const RRF_K=60;
function fuse(keyword:Candidate[],semantic:Candidate[],k=RRF_K):Candidate[]{
 const score=new Map<Candidate,number>();
 keyword.forEach((c,i)=>score.set(c,1/(k+i+1)));
 // Passage level: a semantic chunk overlapping a keyword window boosts that window (which keeps its exact match).
 semantic.forEach((c,i)=>{const same=keyword.find(w=>overlaps(w,c))??c;score.set(same,(score.get(same)??0)+1/(k+i+1));});
 return [...score.keys()].sort((a,b)=>score.get(b)!-score.get(a)!);
}

type GatherOptions={signal?:AbortSignal;maxNotes?:number;maxPassages?:number;maxChars?:number;radius?:number;semantic?:SemanticHit[];related?:Set<string>};
const readable=(n:Summary)=>!n.trashed&&!('locked' in n&&n.locked);

/** Keyword notes first, then notes only the semantic search found; each list is capped separately. */
function notesToRead(notes:Summary[],semantic:SemanticHit[],maxNotes:number){
 const out=notes.filter(readable).slice(0,maxNotes),seen=new Set(out.map(n=>n.id));
 for(const hit of semantic.filter(h=>readable(h.note))){
  if(seen.size>=maxNotes*2)break;
  if(!seen.has(hit.note.id)){seen.add(hit.note.id);out.push(hit.note);}
 }
 return out;
}

/** Picks the best passages per note within a fixed character budget; with semantic hits, keyword and semantic passages are fused by RRF. */
export async function gatherEvidence(notes:Summary[],words:string[],load:(note:Summary,signal?:AbortSignal)=>Promise<string|SearchDocument>,options:GatherOptions={}):Promise<Evidence[]>{
 const {signal,maxNotes=20,maxPassages=8,maxChars=12000,radius=300,semantic=[],related}=options;
 const lowerWords=words.map(w=>w.toLocaleLowerCase());
 const found:Candidate[]=[],near:Candidate[]=[];
 // Sequential on purpose: notes are read one by one so cancelling stops further reads.
 for(const note of notesToRead(notes,semantic,maxNotes)){
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  let body:string|SearchDocument;
  try{body=await load(note,signal);} // NOSONAR: one read at a time so cancelling stops further reads
  catch(error){
   if(signal?.aborted)throw error;
   continue; // Notes that changed or locked meanwhile are skipped.
  }
  if(words.length)found.push(...noteWindows(note,body,words,lowerWords,radius,related?.has(note.id)));
  for(const hit of semantic)if(hit.note.id===note.id)near.push(semanticCandidate(hit,body));
 }
 found.sort((a,b)=>b.score-a.score);
 near.sort((a,b)=>b.score-a.score);
 return pick(fuse(found,near),maxPassages,maxChars);
}

function pick(ranked:Candidate[],maxPassages:number,maxChars:number):Evidence[]{
 const picked:Evidence[]=[],used:Candidate[]=[];let chars=0;
 for(const c of ranked){
  const passage=c.text.slice(c.start,c.end).trim();
  if(!passage||chars+passage.length>maxChars||used.some(u=>overlaps(u,c)))continue;
  chars+=passage.length;
  used.push(c);
  picked.push(toEvidence(c,picked.length+1,passage));
  if(picked.length===maxPassages)break;
 }
 return picked;
}

/** Typed relation context between numbered sources, e.g. "[1] 책 —저자→ [2] 사람". Only edges whose both ends were sent. */
export function relationLines(evidence:Evidence[],edges:RelationEdge[]):string[]{
 const number=new Map<string,number>();
 for(const e of evidence)if(!number.has(e.note.id))number.set(e.note.id,e.n);
 const lines=new Set<string>();
 for(const edge of edges){
  const from=number.get(edge.source),to=number.get(edge.target);
  if(from===undefined||to===undefined||from===to)continue;
  const name=edge.kind==='relation'?edge.property??'relation':edge.kind.replace('title_','');
  lines.add(`[${from}] ${edge.source_title} —${name}→ [${to}] ${edge.target_title}`);
 }
 return [...lines];
}

export function answerPrompt(question:string,evidence:Evidence[],edges:RelationEdge[]=[]){
 const relations=relationLines(evidence,edges);
 return {
  instruction:'Answer the question using only the numbered sources in the document. Cite each claim with its source number like [1]. If the sources do not answer the question, say so plainly instead of guessing. '+(relations.length?'The Relations block lists typed links between sources (source —relation→ target); follow them to connect facts across sources and cite every source you use. ':'')+'Answer in the language of the question.\n\nQuestion: '+question,
  source:evidence.map(e=>`[${e.n}] ${e.note.title}\n${e.text}`).join('\n\n')+(relations.length?'\n\nRelations:\n'+relations.join('\n'):''),
 };
}

type RelationLoaders={relations:(id:string,signal?:AbortSignal)=>Promise<RelationEdge[]>;summary:(id:string,signal?:AbortSignal)=>Promise<Summary>};
/** One typed hop from the best evidence notes: extra candidate notes plus the edges to describe. */
export async function relatedNotes(evidence:Evidence[],candidates:Summary[],load:RelationLoaders,options:{signal?:AbortSignal;maxFrom?:number;maxNotes?:number}={}):Promise<{notes:Summary[];edges:RelationEdge[]}>{
 const {signal,maxFrom=3,maxNotes=5}=options;
 const known=new Set(candidates.map(n=>n.id)),from=[...new Set(evidence.map(e=>e.note.id))].slice(0,maxFrom);
 const edges=await loadEdges(from,load,signal);
 return {notes:await relatedSummaries(edges,known,load,maxNotes,signal),edges};
}

async function loadEdges(from:string[],load:RelationLoaders,signal?:AbortSignal){
 const edges:RelationEdge[]=[];
 for(const id of from){
  try{edges.push(...await load.relations(id,signal));} // NOSONAR: sequential so cancelling stops further reads
  catch(error){if(signal?.aborted)throw error;}
 }
 return edges;
}

/** Readable notes at the far end of each edge, not already known, at most `maxNotes`. */
async function relatedSummaries(edges:RelationEdge[],known:Set<string>,load:RelationLoaders,maxNotes:number,signal?:AbortSignal){
 const notes:Summary[]=[];
 for(const edge of edges){
  const id=edge.direction==='out'?edge.target:edge.source;
  if(known.has(id)||notes.length===maxNotes)continue;
  known.add(id);
  try{
   const note=await load.summary(id,signal); // NOSONAR: sequential so cancelling stops further reads
   if(readable(note))notes.push(note);
  }catch(error){if(signal?.aborted)throw error;}
 }
 return notes;
}

/** Splits an answer into text and citations; numbers the model invented stay plain text. */
export function answerParts(answer:string,evidence:Evidence[]):AnswerPart[]{
 const parts:AnswerPart[]=[];let at=0;
 for(const m of answer.matchAll(/\[(\d{1,3})\]/g)){
  const cite=evidence.find(e=>e.n===Number(m[1]));
  if(!cite)continue;
  if(m.index>at)parts.push({text:answer.slice(at,m.index),at});
  parts.push({cite});at=m.index+m[0].length;
 }
 if(at<answer.length)parts.push({text:answer.slice(at),at});
 return parts;
}
