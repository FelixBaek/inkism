import type {KnowledgeItem, SavedView} from './knowledge';
type Value = number|string|boolean|string[];
export type Calculation = {value?:Value;error?:'syntax'|'missing'|'zero'|'limit'};
type Expr = {kind:'literal';value:Value}|{kind:'property';name:string}|{kind:'call';name:string;args:Expr[]}|{kind:'binary';op:string;left:Expr;right:Expr};
/** Bounded expression parser: no eval, member access, executable code or implicit coercion. */
export function calculate(expression:string,note:KnowledgeItem,related:KnowledgeItem[]=[]):Calculation {
 if(expression.length>512)return {error:'limit'};
 let index=0,tokens=0,depth=0,steps=0;
 const fail=(error:Calculation['error']):never=>{throw error;};
 const space=()=>{while(index<expression.length&&/\s/.test(expression[index]))index++;};
 const atom=():Expr=>{
  if(++tokens>128||++depth>32)fail('limit');space();let node:Expr;const char=expression[index];
  if(char==='+'||char==='-'){index++;node={kind:'binary',op:char,left:{kind:'literal',value:0},right:atom()};}
  else if(char==='('){index++;node=compare();space();if(expression[index++]!==')')fail('syntax');}
  else if(char==='['){const end=expression.indexOf(']',++index);if(end<0)fail('syntax');node={kind:'property',name:expression.slice(index,end)};index=end+1;}
  else if(char==='"'){const match=/^"(?:[^"\\]|\\["\\nrt])*"/.exec(expression.slice(index));if(!match)fail('syntax');index+=match![0].length;node={kind:'literal',value:JSON.parse(match![0])};}
  else if(/[a-z]/i.test(char??'')){
   const name=/^[a-z][a-z0-9_]*/i.exec(expression.slice(index))![0].toLowerCase();index+=name.length;space();
   if(name==='true'||name==='false')node={kind:'literal',value:name==='true'};
   else{if(expression[index++]!=='(')fail('syntax');const args:Expr[]=[];space();if(expression[index]!==')'){do{args.push(compare());space();if(expression[index]!==',')break;index++;}while(args.length<32);}if(expression[index++]!==')')fail('syntax');node={kind:'call',name,args};}
  }else{const match=/^(?:\d+(?:\.\d*)?|\.\d+)/.exec(expression.slice(index));if(!match)fail('syntax');index+=match![0].length;node={kind:'literal',value:Number(match![0])};}
  depth--;return node;
 };
 const product=():Expr=>{let left=atom();space();while(expression[index]==='*'||expression[index]==='/'){const op=expression[index++];left={kind:'binary',op,left,right:atom()};space();}return left;};
 const sum=():Expr=>{let left=product();space();while(expression[index]==='+'||expression[index]==='-'){const op=expression[index++];left={kind:'binary',op,left,right:product()};space();}return left;};
 const compare=():Expr=>{let left=sum();space();const match=/^(==|!=|>=|<=|>|<)/.exec(expression.slice(index));if(match){index+=match[0].length;left={kind:'binary',op:match[0],left,right:sum()};}return left;};
 const number=(v:Value):number=>typeof v==='number'&&Number.isFinite(v)?v:fail('missing');
 const string=(v:Value):string=>typeof v==='string'?v:fail('missing');
 const date=(v:Value):Date=>{const raw=string(v);if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))fail('syntax');const d=new Date(raw+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==raw)fail('syntax');return d;};
 const evaluate=(node:Expr):Value=>{
  if(++steps>256)fail('limit');let result:Value;
  if(node.kind==='literal')result=node.value;
  else if(node.kind==='property'){const p=note.properties.find(p=>p.name===node.name);if(!p)fail('missing');result=p!.value;}
  else if(node.kind==='binary'){
   const left=evaluate(node.left),right=evaluate(node.right);
   if(['==','!=','>','<','>=','<='].includes(node.op)){
    if(typeof left!==typeof right||Array.isArray(left)||Array.isArray(right))fail('missing');
    result=node.op==='=='?left===right:node.op==='!='?left!==right:node.op==='>'?left>right:node.op==='<'?left<right:node.op==='>='?left>=right:left<=right;
   }else{const a=number(left),b=number(right);if(node.op==='/'&&b===0)fail('zero');result=node.op==='+'?a+b:node.op==='-'?a-b:node.op==='*'?a*b:a/b;}
  }else{
   if(node.name==='if'){if(node.args.length!==3)fail('syntax');const condition=evaluate(node.args[0]);if(typeof condition!=='boolean')fail('missing');return evaluate(node.args[condition?1:2]);}
   const args=node.args.map(evaluate),arity=(n:number)=>{if(args.length!==n)fail('syntax');};
   switch(node.name){
    case 'concat':result=args.map(string).join('');break;
    case 'lower':arity(1);result=string(args[0]).toLowerCase();break;
    case 'upper':arity(1);result=string(args[0]).toUpperCase();break;
    case 'length':arity(1);result=Array.isArray(args[0])?args[0].length:Array.from(string(args[0])).length;break;
    case 'contains':arity(2);result=Array.isArray(args[0])?args[0].includes(string(args[1])):string(args[0]).includes(string(args[1]));break;
    case 'abs':arity(1);result=Math.abs(number(args[0]));break;
    case 'round':arity(1);result=Math.round(number(args[0]));break;
    case 'min':case 'max':if(!args.length)fail('syntax');result=Math[node.name](...args.map(number));break;
    case 'year':arity(1);result=date(args[0]).getUTCFullYear();break;
    case 'month':arity(1);result=date(args[0]).getUTCMonth()+1;break;
    case 'day':arity(1);result=date(args[0]).getUTCDate();break;
    case 'days_between':arity(2);result=(date(args[1]).getTime()-date(args[0]).getTime())/86400000;break;
    case 'relation_sum':{
     arity(2);if(!Array.isArray(args[0])||args[0].length>128)fail('limit');const property=string(args[1]),byId=new Map(related.map(item=>[item.id,item]));let total=0;
     for(const id of new Set(args[0] as string[])){const item=byId.get(id);if(!item)fail('missing');const value=item!.properties.find(p=>p.name===property)?.value;if(value===undefined)fail('missing');total+=number(value!);}
     result=total;break;
    }
    default:return fail('syntax');
   }
  }
  if(typeof result==='number'&&!Number.isFinite(result)||typeof result==='string'&&result.length>10000||Array.isArray(result)&&result.length>128)fail('limit');return result;
 };
 try{const tree=compare();space();if(index!==expression.length)fail('syntax');return {value:evaluate(tree)};}catch(error){return {error:['syntax','missing','zero','limit'].includes(String(error))?error as Calculation['error']:'syntax'};}
}
export function aggregate(notes:KnowledgeItem[],view:SavedView,related:KnowledgeItem[]=notes):{value:number|null;errors:number} {
 const setting=view.aggregate??{operation:'count',property:''};
 if(setting.operation==='count')return {value:notes.length,errors:0};
 const formula=view.formulas?.find(f=>`formula:${f.id}`===setting.property);
 const results=notes.map(n=>formula?calculate(formula.expression,n,related):{value:n.properties.find(p=>p.name===setting.property&&p.type==='number')?.value as number|undefined});
 const numbers=results.map(r=>r.value).filter((x):x is number=>typeof x==='number'&&Number.isFinite(x));
 const errors=results.filter(r=>r.error).length;
 if(!numbers.length)return {value:null,errors};
 let value=setting.operation==='min'?Math.min(...numbers):setting.operation==='max'?Math.max(...numbers):numbers.reduce((a,b)=>a+b,0);
 if(setting.operation==='average')value/=numbers.length;
 return Number.isFinite(value)?{value,errors}:{value:null,errors:errors+1};
}
