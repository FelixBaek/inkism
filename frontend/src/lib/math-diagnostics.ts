export interface MathDiagnostic {message:string;start:number|null;end:number|null;line:number|null;column:number|null}
/** KaTeX offsets use JavaScript UTF-16 indices, as does textarea selection. */
export function mathDiagnostic(error:unknown,source:string):MathDiagnostic {
 const detail=error as {message?:unknown;position?:unknown;length?:unknown}|null;
 const position=detail?.position;
 const start=typeof position==='number'&&Number.isInteger(position)&&position>=0&&position<=source.length?position:null;
 const length=typeof detail?.length==='number'&&Number.isInteger(detail.length)&&detail.length>0?detail.length:1;
 const before=start===null?null:source.slice(0,start);
 return {message:typeof detail?.message==='string'?detail.message:String(error),start,end:start===null?null:Math.min(source.length,start+length),line:before===null?null:before.split('\n').length,column:before===null?null:before.length-before.lastIndexOf('\n')};
}
