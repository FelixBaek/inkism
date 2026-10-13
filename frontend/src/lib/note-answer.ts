import {sourcePosition,type SearchDocument} from './search-document-core';
import type {SearchHit} from './global-search-core';
import type {Summary} from '../types';
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
function noteWindows(note:Summary,body:string|SearchDocument,words:string[],lowerWords:string[],radius:number):Candidate[]{
 const doc=typeof body==='string'?undefined:body,text=typeof body==='string'?body:body.text,lower=text.toLocaleLowerCase();
 const windows:Candidate[]=[];
 const positions=lowerWords.flatMap((word,k)=>occurrences(lower,word).map(at=>({at,k}))).sort((a,b)=>a.at-b.at);
 for(const {at,k} of positions){
  const start=Math.max(0,at-radius),end=Math.min(text.length,at+lowerWords[k].length+radius),prev=windows.at(-1);
  if(prev&&start<=prev.end)prev.end=Math.max(prev.end,end);
  else windows.push({note,doc,text,start,end,first:at,word:words[k],score:0});
 }
 const title=note.title.toLocaleLowerCase(),titleHits=lowerWords.filter(w=>title.includes(w)).length;
 if(!windows.length&&titleHits&&text.trim())windows.push({note,doc,text,start:0,end:Math.min(text.length,radius*2),first:0,word:'',score:0});
 for(const w of windows){const slice=lower.slice(w.start,w.end);w.score=lowerWords.filter(x=>slice.includes(x)).length*10+titleHits*5+lowerWords.reduce((sum,x)=>sum+occurrences(slice,x).length,0);}
 windows.sort((a,b)=>b.score-a.score);
 return windows.slice(0,2);
}

function toEvidence(c:Candidate,n:number,passage:string):Evidence{
 const matched=c.text.slice(c.first,c.first+c.word.length);
 let occurrence=0,at=0;
 while(matched&&at<c.first){const next=c.text.indexOf(matched,at);if(next<0||next>=c.first)break;occurrence++;at=next+matched.length;}
 const line=c.text.slice(0,c.first).split('\n').length;
 return {n,note:c.note,text:passage,hit:{note:c.note,index:c.first,line,snippet:passage.slice(0,240),matchStart:0,matchLength:0,
  sourceOffset:c.doc?sourcePosition(c.doc,c.first):undefined,sourceEnd:c.doc?sourcePosition(c.doc,c.first+matched.length,true):undefined,revision:c.doc?.revision,matchedText:matched,occurrence}};
}

/** Picks the best passages per note within a fixed character budget. */
export async function gatherEvidence(notes:Summary[],words:string[],load:(note:Summary,signal?:AbortSignal)=>Promise<string|SearchDocument>,options:{signal?:AbortSignal;maxNotes?:number;maxPassages?:number;maxChars?:number;radius?:number}={}):Promise<Evidence[]>{
 const {signal,maxNotes=20,maxPassages=8,maxChars=12000,radius=300}=options;
 const lowerWords=words.map(w=>w.toLocaleLowerCase());
 const found:Candidate[]=[];
 // Sequential on purpose: notes are read one by one so cancelling stops further reads.
 for(const note of notes.filter(n=>!n.trashed&&!('locked' in n&&n.locked)).slice(0,maxNotes)){
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  let body:string|SearchDocument;
  try{body=await load(note,signal);}
  catch(error){if(signal?.aborted)throw error;continue;} // Notes that changed or locked meanwhile are skipped.
  found.push(...noteWindows(note,body,words,lowerWords,radius));
 }
 const picked:Evidence[]=[];let chars=0;
 found.sort((a,b)=>b.score-a.score);
 for(const c of found){
  const passage=c.text.slice(c.start,c.end).trim();
  if(!passage||chars+passage.length>maxChars)continue;
  chars+=passage.length;
  picked.push(toEvidence(c,picked.length+1,passage));
  if(picked.length===maxPassages)break;
 }
 return picked;
}

export function answerPrompt(question:string,evidence:Evidence[]){
 return {
  instruction:'Answer the question using only the numbered sources in the document. Cite each claim with its source number like [1]. If the sources do not answer the question, say so plainly instead of guessing. Answer in the language of the question.\n\nQuestion: '+question,
  source:evidence.map(e=>`[${e.n}] ${e.note.title}\n${e.text}`).join('\n\n'),
 };
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
