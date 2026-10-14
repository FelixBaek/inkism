import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { termDefinitionRange } from "../lib/term-definition-range";
import { registerCommands } from "../lib/app-commands";
import { completeAI } from "../lib/ai-provider";
import { termGlossary, type TermGlossaryEntry } from "../lib/term-glossary";
import { api } from "../api";
import { useStore } from "../store";
import { t } from "../i18n";
import { Eraser, Pencil, SparklesAi, X } from "../icons";
import "./TermDefinitionPopover.css";

const OPEN = "inkism-term-definition";
/** Creates the expanded note once; a retry after an ambiguous failure recovers the same note. */
async function promoteNote(id:string,title:string,text:string) {
  try { return await api.save({id,title,content:text,text,content_format:"text",require_absent:true}); }
  catch (error_) {
    // A response may fail after the server commits. Recover our exact
    // promoted note rather than creating another note on retry.
    let existing;
    try { existing=await api.get(id); } catch { throw error_; }
    if(existing.title!==title || existing.content!==text || existing.content_format!=="text"){throw error_;}
    return existing;
  }
}

export function openTermDefinition(editor: Editor) { editor.view.dom.dispatchEvent(new Event(OPEN)); }
export function canDefineTerm(editor: Editor) {
  const { selection, doc } = editor.state;
  // Browser caret movement can precede ProseMirror's selectionchange handler.
  // Never consume Ctrl+G for that transient, stale model selection.
  const native=editor.view.dom.ownerDocument.getSelection();
  if(editor.isFocused && native?.isCollapsed)return false;
  return editor.isEditable && !!editor.schema.marks.termDefinition && selection instanceof TextSelection && !selection.empty &&
    selection.$from.sameParent(selection.$to) && doc.textBetween(selection.from, selection.to).trim().length > 0 &&
    doc.textBetween(selection.from, selection.to).length <= 120;
}
type Target = { from: number; to: number; term: string; id: string; definition: string; glossaryId?: string; noteId?: string; doc: PMNode; left: number; top: number; preview: boolean; createdNoteId?: string; promotionId?: string };

export function TermDefinitionPopover({ editor, readOnly = false, disabled = false }: { editor: Editor; readOnly?: boolean; disabled?: boolean }) {
  const store = useStore();
  const [target, setTarget] = useState<Target | null>(null);
  const [definition, setDefinition] = useState("");
  const [glossary, setGlossary] = useState(false);
  const [entries,setEntries] = useState<TermGlossaryEntry[]>([]);
  const [selectedGlossaryId,setSelectedGlossaryId] = useState("");
  const [saving,setSaving] = useState(false);
  const mutating = useRef(false);
  const dirty = useRef(false);
  const [noteId, setNoteId] = useState("");
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<{id:string;title:string}[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiPreview, setAiPreview] = useState(false);
  const [expand, setExpand] = useState(false);
  const panel = useRef<HTMLDialogElement>(null);
  const abort = useRef<AbortController>();
  const active = useRef<Target | null>(null);
  const showTimer = useRef<number>();
  const hideTimer = useRef<number>();
  const close = () => { if(mutating.current){return;} abort.current?.abort(); active.current = null; setTarget(null); setBusy(false); };
  const valid = (item: Target) => active.current === item && !editor.isDestroyed && editor.state.doc === item.doc && editor.isEditable && !readOnly && !disabled;
  const show = (item: Target) => {
    abort.current?.abort(); dirty.current=false; active.current = item; setTarget(item); setDefinition(item.definition); setNoteId(item.noteId ?? "");
    setSelectedGlossaryId(item.glossaryId ?? ""); setGlossary(false); setError(""); setBusy(false); setAiPreview(false); setExpand(false); setQuery(""); setNotes([]);
    void termGlossary.list().then(entries => {
      if(active.current === item)setEntries(entries);
      const entry = entries.find(entry => entry.id === item.glossaryId);
      if (entry && active.current === item && !dirty.current) { setDefinition(entry.definition.slice(0,2000)); setNoteId(entry.noteId ?? item.noteId ?? ""); }
    }).catch(() => {});
  };
  useEffect(() => {
    setTarget(null); active.current=null;
    const dom = editor.view.dom;
    const decorationKey=new PluginKey("term-definition-accessibility");
    editor.registerPlugin(new Plugin({key:decorationKey,props:{decorations(state){
      const decorations: Decoration[]=[];
      state.doc.descendants((node,pos)=>{const marked=node.marks.some(mark=>mark.type.name==="termDefinition");if(node.isText && marked)decorations.push(Decoration.inline(pos,pos+node.nodeSize,{tabindex:"0",role:"button","aria-label":`${node.text}: ${t("용어 설명")}`}));});
      return DecorationSet.create(state.doc,decorations);
    }}}));
    const position = (from: number) => { const c = editor.view.coordsAtPos(from); return {left: Math.max(12, Math.min(c.left, window.innerWidth - 372)), top: Math.max(12, Math.min(c.bottom + 10, window.innerHeight - 440))}; };
    const open = () => {
      if (disabled || readOnly || !canDefineTerm(editor)) return;
      let {from,to} = editor.state.selection;
      const occurrence=termDefinitionRange(editor.state.doc,from);
      if(occurrence && to<=occurrence.to) {
        const {from:start,to:end,mark:existing}=occurrence;
        show({from:start,to:end,term:editor.state.doc.textBetween(start,end),id:existing.attrs.id,definition:existing.attrs.definition,glossaryId:existing.attrs.glossaryId,noteId:existing.attrs.noteId,doc:editor.state.doc,...position(start),preview:false});return;
      }
      show({from,to,term:editor.state.doc.textBetween(from,to),id:crypto.randomUUID(),definition:"",doc:editor.state.doc,...position(from),preview:false});
    };
    // 저장된 용어: 마우스를 올리면 잠깐 뒤(250ms) 작은 카드를 보이고, 용어·카드 밖으로 나가면 200ms 뒤 숨긴다.
    // 키보드 포커스·클릭(터치)은 바로 보인다. 편집 창이 열려 있으면 건드리지 않는다.
    const termAt = (event: Event) => {
      const span = (event.target as HTMLElement)?.closest?.<HTMLElement>("[data-term-id]");
      return span && dom.contains(span) ? span : null;
    };
    const previewOf = (span: HTMLElement): Target | null => {
      const id = span.dataset.termId!;
      const occurrence=termDefinitionRange(editor.state.doc,editor.view.posAtDOM(span,0),id);
      if(!occurrence)return null;
      const {from,to,mark}=occurrence;
      return {from,to,term:editor.state.doc.textBetween(from,to),id,definition:mark.attrs.definition??"",glossaryId:mark.attrs.glossaryId,noteId:mark.attrs.noteId,doc:editor.state.doc,...position(from),preview:true};
    };
    const existing = (event: Event, delay = 0) => {
      const span = termAt(event);
      if (!span || disabled) return;
      window.clearTimeout(hideTimer.current); window.clearTimeout(showTimer.current);
      const current = active.current;
      if (current && (!current.preview || current.id === span.dataset.termId)) return;
      const open = () => { const item = previewOf(span); if (item && (!active.current || active.current.preview)) show(item); };
      if (delay) showTimer.current = window.setTimeout(open, delay); else open();
    };
    const hover = (event: Event) => existing(event, 250);
    const leave = (event: Event) => {
      const to = (event as MouseEvent).relatedTarget as Node | null;
      const from = termAt(event);
      if (!from || (to && (from.contains(to) || panel.current?.contains(to)))) return;
      window.clearTimeout(showTimer.current);
      if (active.current?.preview) hideTimer.current = window.setTimeout(() => { if (active.current?.preview) close(); }, 200);
    };
    let unregister: (() => void) | undefined;
    const register = () => {
      unregister?.();
      unregister = registerCommands([{id:"editor.term-definition",label:t("용어 설명"),shortcut:"mod+g",run:open,
        enabled:()=>!readOnly && !disabled && !editor.isDestroyed && !editor.view.composing && dom.contains(document.activeElement) && canDefineTerm(editor)}]);
    };
    register();
    const selectionChanged = () => {
      const item=active.current;
      if(item && !mutating.current && !item.preview && editor.isFocused && (editor.state.selection.from!==item.from || editor.state.selection.to!==item.to)) close();
    };
    const update = () => { if (active.current && editor.state.doc !== active.current.doc && !mutating.current) close(); };
    dom.addEventListener(OPEN,open); dom.addEventListener("mouseover",hover); dom.addEventListener("mouseout",leave); dom.addEventListener("focusin",existing); dom.addEventListener("focusout",leave); dom.addEventListener("click",existing);
    dom.addEventListener("focusin",register); editor.on("transaction",update); editor.on("selectionUpdate",selectionChanged);
    return () => { abort.current?.abort(); active.current=null; if(!editor.isDestroyed){editor.unregisterPlugin(decorationKey);} dom.removeEventListener(OPEN,open); window.clearTimeout(showTimer.current); window.clearTimeout(hideTimer.current); dom.removeEventListener("mouseover",hover); dom.removeEventListener("mouseout",leave); dom.removeEventListener("focusin",existing); dom.removeEventListener("focusout",leave); dom.removeEventListener("click",existing); dom.removeEventListener("focusin",register); unregister?.(); editor.off("transaction",update); editor.off("selectionUpdate",selectionChanged); };
  }, [editor,readOnly,disabled]);
  useLayoutEffect(() => {
    const element=panel.current;
    if(!target || !element)return;
    const place=()=>{
      const bounds=element.getBoundingClientRect();
      // Measure after details/validation/AI content changes; the small initial
      // estimate cannot predict an expanded panel on narrow screens.
      element.style.left=`${Math.max(12,Math.min(target.left,window.innerWidth-bounds.width-12))}px`;
      let top=Math.max(12,Math.min(target.top,window.innerHeight-bounds.height-12));
      // 서식 메뉴가 떠 있으면 겹치지 않게 용어 위쪽으로 옮긴다(자리가 없으면 그대로).
      const menu=document.querySelector(".format-menu")?.getBoundingClientRect();
      const left=element.getBoundingClientRect().left;
      if(target.preview && menu && menu.width && top<menu.bottom && top+bounds.height>menu.top && left<menu.right && left+bounds.width>menu.left){
        const above=editor.view.coordsAtPos(target.from).top-10-bounds.height;
        if(above>=12 && (above+bounds.height<=menu.top || above>=menu.bottom))top=above;
      }
      element.style.top=`${top}px`;
    };
    place();
    const observer=new ResizeObserver(place);
    observer.observe(element);
    window.addEventListener("resize",place);
    return()=>{observer.disconnect();window.removeEventListener("resize",place);};
  }, [target]);
  useEffect(() => {
    if (!target) return;
    const outside = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node)) close(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); if(!mutating.current){close(); if(!editor.isDestroyed)editor.view.focus();} } };
    document.addEventListener("pointerdown",outside); document.addEventListener("keydown",escape);
    return () => { document.removeEventListener("pointerdown",outside); document.removeEventListener("keydown",escape); };
  }, [target]);
  useEffect(() => {
    let alive = true;
    if (!query.trim()) {setNotes([]); return;}
    const timer = setTimeout(() => { void api.list({view:"all",query:query.trim(),limit:8}).then(r => {if(alive)setNotes(r.items);}).catch(e => {if(alive)setError(String(e));}); },250);
    return () => {alive=false;clearTimeout(timer);};
  }, [query]);
  const generate = async () => {
    if (!target || !valid(target)) return;
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    setBusy(true); setError("");
    try {
      const context = target.doc.textBetween(Math.max(0,target.from-1200),Math.min(target.doc.content.size,target.to+1200),"\n");
      const text = await completeAI(`Explain the selected term ${JSON.stringify(target.term)} in this document's context, in the document's language. Use 1–3 short sentences, at most 2000 characters, plain text only. Do not invent certainty when context is insufficient.`,context,controller.signal);
      if (valid(target) && !controller.signal.aborted) {dirty.current=true;setDefinition(text.trim().slice(0,2000));setAiPreview(true);}
    } catch(e) {if(!controller.signal.aborted && valid(target))setError(e instanceof Error ? e.message : String(e));}
    finally {if(active.current===target)setBusy(false);}
  };
  const saveGlossary = async (target: Target, glossaryId: string|undefined, linked: string|undefined) => {
    const selectedEntry=entries.find(entry=>entry.id===glossaryId);
    const entry=await termGlossary.save({id:glossaryId,term:target.term,definition:definition.trim(),noteId:linked,type:selectedEntry?.type,lang:selectedEntry?.lang});
    target.glossaryId=entry.id; setSelectedGlossaryId(entry.id);
    return entry.id;
  };
  /** The note to link: the chosen one, or (when expanding) a note created once per target. */
  const linkedNote = async (target: Target) => {
    if (!expand) return noteId || undefined;
    if (target.createdNoteId) return target.createdNoteId;
    target.promotionId ??= crypto.randomUUID();
    const created=await promoteNote(target.promotionId,target.term,definition.trim());
    target.createdNoteId=created.id; setNoteId(created.id); store.refreshList();
    return created.id;
  };
  const settle = (target: Target) => {
    if (active.current!==target) return;
    setBusy(false);
    if (editor.isDestroyed || editor.state.doc!==target.doc) setError(t("문서가 변경되어 본문 설명을 저장하지 않았습니다. 생성한 노트와 용어집 항목은 유지됩니다."));
  };
  const save = async () => {
    if (!target || !valid(target) || !definition.trim() || definition.length>2000 || busy) return;
    mutating.current=true; setSaving(true); setBusy(true); setError("");
    try {
      const linked = await linkedNote(target);
      let glossaryId = selectedGlossaryId || undefined;
      if (!valid(target)) return;
      if (glossary || (expand && glossaryId)) glossaryId=await saveGlossary(target,glossaryId,linked);
      if (!valid(target)) return;
      const applied=editor.chain().focus().setTextSelection({from:target.from,to:target.to}).setMark("termDefinition",{id:target.id,definition:definition.trim(),glossaryId:glossaryId??null,noteId:linked??null}).run();
      if(!applied)throw new Error(t("설명을 본문에 적용하지 못했습니다. 선택 영역을 다시 확인하세요."));
      mutating.current=false; close();
    } catch(e) {if(active.current===target)setError(e instanceof Error?e.message:String(e));}
    finally {mutating.current=false;setSaving(false);settle(target);}
  };
  /** 카드의 지우개: 확인 없이 이 용어의 설명 표시만 지운다. 편집 트랜잭션이라 Ctrl+Z로 되돌린다. */
  const erase = () => {
    if(!target || !valid(target))return;
    const type=editor.schema.marks.termDefinition;
    editor.view.dispatch(editor.state.tr.removeMark(target.from,target.to,type));
    close();
  };
  const remove = () => { if(!target || !valid(target)){return;} editor.chain().focus().setTextSelection({from:target.from,to:target.to}).unsetMark("termDefinition").run();close(); };
  if (!target) return null;
  const preview = target.preview;
  const hoverCard = { onMouseEnter: () => window.clearTimeout(hideTimer.current), onMouseLeave: (event: React.MouseEvent) => {
    const to = event.relatedTarget as Node | null;
    if (!preview || (to instanceof Element && to.closest(`[data-term-id="${CSS.escape(target.id)}"]`))) return;
    hideTimer.current = window.setTimeout(() => { if (active.current?.preview) close(); }, 200);
  } };
  return createPortal(<dialog open ref={panel} className={`term-definition-popover${preview?" is-preview":""}`} style={{left:target.left,top:target.top}} aria-label={t("용어 설명")} {...hoverCard}>
    {preview ? <>
      {!readOnly && editor.isEditable && <div className="term-definition-tools">
        <button type="button" aria-label={t("설명 수정")} title={t("설명 수정")} onClick={()=>{const next={...target,preview:false};active.current=next;setTarget(next);}}><Pencil size={14} aria-hidden /></button>
        <button type="button" aria-label={t("설명 제거")} title={t("설명 제거")} onClick={erase}><Eraser size={14} aria-hidden /></button>
      </div>}
      <strong className="term-definition-word">{target.term}</strong>
      <p className="term-definition-preview">{definition}</p>
      {noteId && <a href={`note://${noteId}`}>{t("연결된 노트 열기")}</a>}
    </> : <>
      <header><strong className="term-definition-word">{target.term}</strong><button type="button" className="term-definition-close" aria-label={t("닫기")} disabled={saving} onClick={()=>{close();if(!editor.isDestroyed)editor.view.focus();}}><X size={14} aria-hidden /></button></header>
      <textarea aria-label={t("짧은 설명")} autoFocus maxLength={2000} rows={3} value={definition} disabled={busy} onChange={e=>{dirty.current=true;setDefinition(e.target.value);setAiPreview(false);}} placeholder={t("이 문맥에서 쓰인 의미를 적어 주세요.")} />
      <div className="term-definition-ai"><button type="button" disabled={busy} onClick={()=>void generate()}><SparklesAi size={14} aria-hidden />{t("AI로 설명")}</button><small>{definition.length}/2000</small></div>
      {busy && <p><output>{t("처리 중…")}</output> <button type="button" disabled={saving} onClick={close}>{t("취소")}</button></p>}
      {aiPreview && <output className="term-definition-hint">{t("AI 초안입니다. 확인한 뒤 저장하세요.")}</output>}
      <details><summary>{t("용어집 · 노트 연결")}</summary>
        <label className="term-definition-label">{t("연결할 용어집 항목")}<select value={selectedGlossaryId} disabled={busy} onChange={e=>{dirty.current=true;setSelectedGlossaryId(e.target.value);const entry=entries.find(x=>x.id===e.target.value);if(entry){setDefinition(entry.definition.slice(0,2000));setNoteId(entry.noteId??"");}}}><option value="">{t("새 용어집 항목")}</option>{entries.map(entry=><option key={entry.id} value={entry.id}>{entry.term}{entry.lang?` (${entry.lang})`:""} — {entry.definition.slice(0,48)}</option>)}</select></label>
        <label><input type="checkbox" checked={glossary} disabled={busy} onChange={e=>setGlossary(e.target.checked)}/>{t("용어집에도 저장")}</label>
        <label className="term-definition-label">{t("기존 노트 찾기")}<input value={query} disabled={busy||expand} onChange={e=>setQuery(e.target.value)} /></label>
        {notes.map(note=><button type="button" className="term-definition-result" key={note.id} disabled={busy} onClick={()=>{dirty.current=true;setNoteId(note.id);setQuery("");}}>{note.title}</button>)}
        {noteId && <div>{t("노트 연결됨")} <button type="button" disabled={busy} onClick={()=>{dirty.current=true;setNoteId("");}}>{t("연결 해제")}</button></div>}
        <label><input type="checkbox" checked={expand} disabled={busy} onChange={e=>setExpand(e.target.checked)}/>{t("설명을 새 노트로 확장")}</label>
      </details>
      <footer>{target.definition && <button type="button" className="term-definition-remove" disabled={busy} onClick={remove}>{t("설명 제거")}</button>}<span /><button type="button" disabled={saving} onClick={()=>{close();if(!editor.isDestroyed)editor.view.focus();}}>{t("취소")}</button><button type="button" className="term-definition-save" disabled={busy||!definition.trim()||!valid(target)} onClick={()=>void save()}>{t("저장")}</button></footer>
    </>}
    {error && <p role="alert">{error}</p>}
  </dialog>, document.body);
}
