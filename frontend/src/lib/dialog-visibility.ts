import {useEffect,useRef,type RefObject} from 'react';
/** Restore focus to a visible control when responsive layout hides the opener. */
export function useDialogVisibility(dialog:RefObject<HTMLDialogElement|null>,open:boolean){
 const opener=useRef<HTMLElement|null>(null);
 useEffect(()=>{
  const node=dialog.current;if(!node)return;
  if(open){if(!node.open){opener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;node.showModal();}return;}
  if(!node.open)return;
  node.close();
  const visible=(el:HTMLElement|null):el is HTMLElement=>!!el&&el!==document.body&&el!==document.documentElement&&el.isConnected&&el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden'&&!el.closest('[inert]')&&!(el instanceof HTMLButtonElement&&el.disabled);
  if(visible(opener.current)){opener.current.focus({preventScroll:true});return;}
  const selector='button:not([disabled]), input:not([disabled]), a[href], [tabindex="0"]';
  const candidates=[...document.querySelectorAll<HTMLElement>('dialog[open] '+selector.split(', ').join(', dialog[open] ')),...document.querySelectorAll<HTMLElement>('.mobile-header button'),...document.querySelectorAll<HTMLElement>(selector)];
  candidates.find(visible)?.focus({preventScroll:true});
 },[dialog,open]);
}
