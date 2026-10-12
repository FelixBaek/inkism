import type {Summary} from "../types";
import {rpc} from '../api';
export const TAG_CHANGE_EVENT='inkism-tag-change';
export type TagChangeRequest={name:string;replacement:string|null};
export function requestTagChange(request?:TagChangeRequest){window.dispatchEvent(new CustomEvent(TAG_CHANGE_EVENT,{detail:request}));}
export type TagChangeItem={id:string;title:string;tags:string[];next_tags:string[];revision:number;archived:boolean;trashed:boolean;readonly:boolean;locked:boolean;reason:'readonly'|'locked'|null};
export type TagChangePreview={id:string;name:string;replacement:string|null;status:'preview'|'applied'|'undone';created_at:number;total:number;eligible_count:number;excluded_count:number;items:TagChangeItem[];offset:number;next_offset:number|null;default_tag:{before:string|null;after:string|null;changes:boolean}};
export type TagChangeReceipt={id:string;name:string;replacement:string|null;status:'preview'|'applied'|'undone';created_at:number;applied_at?:number;undone_at?:number;updated:number;default_changed:boolean};
export type TagChangeResult={id:string;status:string;updated:number;affected_ids:string[];default_tag:string|null;current?:Summary|null};
export const tagChanges={preview:(request:TagChangeRequest|{preview_id:string;offset?:number})=>rpc<TagChangePreview>('tag_change_preview',request),apply:(preview_id:string,current_id?:string,current_revision?:number)=>rpc<TagChangeResult>('tag_change_apply',{preview_id,current_id,current_revision}),undo:(id:string,current_id?:string,current_revision?:number)=>rpc<TagChangeResult>('tag_change_undo',{id,current_id,current_revision}),list:()=>rpc<{items:TagChangeReceipt[]}>('tag_change_list')};
