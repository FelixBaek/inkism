import { t } from "../i18n";
import React, { useEffect, useRef, useState } from "react";
import { addBookmark, addGroup, loadBookmarks, toggleGroup, type BookmarkStore } from "../lib/bookmarks";
import "./BookmarkPanel.css";
export function BookmarkPanel({ note, anchor, initialStore, onOpen, onStoreChange }: Readonly<{ note?: { id: string; title: string }; anchor?: string; initialStore?: BookmarkStore; onOpen?: (id: string, anchor?: string) => void; onStoreChange?: (store: BookmarkStore) => void }>) {
  const [store, setStore] = useState<BookmarkStore>(() => initialStore || loadBookmarks());
  const [groupName,setGroupName]=useState("");
  const changed=useRef(onStoreChange);changed.current=onStoreChange;const first=useRef(true);
  useEffect(() => {if(first.current){first.current=false;return;}changed.current?.(store);}, [store]);
  const bookmark = () => { if (!note) return; setStore(s => addBookmark(s, { noteId: note.id, title: note.title, anchor })); };
  const removeBookmark=(id:string)=>setStore(s=>({...s,bookmarks:s.bookmarks.filter(b=>b.id!==id),groups:s.groups.map(g=>({...g,bookmarkIds:g.bookmarkIds.filter(x=>x!==id)}))}));
  return <section className="bookmark-panel" aria-label={t("북마크")}>
    <header><strong>{t("북마크")}</strong><button type="button" onClick={bookmark} disabled={!note}>{anchor?t("현재 위치 저장"):t("현재 노트 저장")}</button></header>
    <form onSubmit={e=>{e.preventDefault();if(groupName.trim()){setStore(s=>addGroup(s,groupName));setGroupName("");}}}><input aria-label={t("새 그룹 이름")} value={groupName} maxLength={80} onChange={e=>setGroupName(e.target.value)}/><button type="submit" disabled={!groupName.trim()}>{t("그룹 추가")}</button></form>
    {store.groups.length === 0 && <p>{t("그룹이 없습니다.")}</p>}
    {store.groups.map(g => <details key={g.id} open><summary>{g.name} <small>{g.bookmarkIds.length}</small></summary><div><input aria-label={t("그룹 이름")} value={g.name} maxLength={80} onChange={e=>setStore(s=>({...s,groups:s.groups.map(x=>x.id===g.id?{...x,name:e.target.value}:x)}))}/><button type="button" onClick={()=>setStore(s=>({...s,groups:s.groups.filter(x=>x.id!==g.id)}))}>{t("그룹 삭제")}</button></div><div>{g.bookmarkIds.map(id=>store.bookmarks.find(b=>b.id===id)).filter(b=>!!b).map((b,index) => <span key={b.id}><button type="button" onClick={() => onOpen?.(b.noteId, b.anchor)}>{b.title}{b.anchor ? ` · ${b.anchor}` : ""}</button><button type="button" aria-label={t("{title} 위로", {title:b.title})} disabled={index===0} onClick={()=>setStore(s=>({...s,groups:s.groups.map(x=>{if(x.id!==g.id)return x;const ids=[...x.bookmarkIds];[ids[index-1],ids[index]]=[ids[index],ids[index-1]];return {...x,bookmarkIds:ids};})}))}>↑</button><button type="button" aria-label={t("{title} 그룹에서 제거", {title:b.title})} onClick={()=>setStore(s=>toggleGroup(s,g.id,b.id))}>{t("그룹에서 제거")}</button></span>)}</div></details>)}
    <details open><summary>{t("전체 북마크")} <small>{store.bookmarks.length}</small></summary>{store.bookmarks.map(b => <div className="bookmark-row" key={b.id}><button type="button" onClick={() => onOpen?.(b.noteId, b.anchor)}>{b.title}</button><input aria-label={t("북마크 이름")} value={b.title} maxLength={500} onChange={e=>setStore(s=>({...s,bookmarks:s.bookmarks.map(x=>x.id===b.id?{...x,title:e.target.value}:x)}))}/>{store.groups.map(g => <button type="button" key={g.id} aria-pressed={g.bookmarkIds.includes(b.id)} title={t("{name} 그룹 변경", {name:g.name})} onClick={() => setStore(s => toggleGroup(s, g.id, b.id))}>{g.bookmarkIds.includes(b.id)?"✓":"＋"}{g.name}</button>)}<button type="button" aria-label={t("{title} 북마크 삭제", {title:b.title})} onClick={()=>removeBookmark(b.id)}>{t("삭제")}</button></div>)}</details>
  </section>;
}
