export type SearchDocument={text:string;source:string;revision:number;segments:{start:number;end:number;sourceStart:number;sourceEnd:number}[];anchors:{kind:string;text:string;id?:string;level:number;sourceOffset:number;sourceEnd?:number}[]};
export function sourcePosition(doc:SearchDocument,index:number,end=false):number {
 if(end&&index>0){const previous=sourcePosition(doc,index-1);const segment=doc.segments.find(s=>s.start<=index-1&&s.end>index-1);return segment&&segment.end-segment.start!==segment.sourceEnd-segment.sourceStart?segment.sourceEnd:previous+1;}
 let lo=0,hi=doc.segments.length;
 while(lo<hi){const mid=(lo+hi)>>>1;if(doc.segments[mid].end<=index)lo=mid+1;else hi=mid;}
 const s=doc.segments[lo];if(!s)return doc.source.length;
 return s.end-s.start===s.sourceEnd-s.sourceStart?s.sourceStart+Math.max(0,index-s.start):end?s.sourceEnd:s.sourceStart;
}
