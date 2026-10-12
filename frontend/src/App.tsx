import {TagChangeDialog} from "./components/TagChangeDialog";
import {requestTagChange} from "./lib/tag-change";
import { api } from "./api";
import {flushWorkspaceForClose} from "./lib/workspace";
import {Whiteboard} from "./components/Whiteboard";
import {LibraryMoreTools} from "./components/LibraryMoreTools";
import {loadFontResources} from "./lib/font-resources";
import {registerCommands,listenCommandShortcuts} from "./lib/app-commands";
import React, { useEffect, useRef, useState } from "react";
import { SecurityBoundary } from "./components/AppSecurity";
import { StoreProvider, useStore } from "./store";
import { Sidebar } from "./components/Sidebar";
import { NoteList } from "./components/NoteList";
import { SplitWorkspace } from "./components/SplitWorkspace";
import { DueReminders } from "./components/Reminders";
import { DialogHost } from "./components/DialogHost";
import { StatusBar } from "./components/EditorPane";
import { CommandPalette } from "./components/CommandPalette";
import { TerminalIcon as Terminal } from "@phosphor-icons/react";
import { NoteTabs } from "./components/NoteTabs";
import { PreviewExport } from "./components/PreviewExport";
import { IconButton } from "./components/IconButton";
import { WindowControls } from "./components/WindowControls";
import { Menu, ArrowLeft, X, Plus, PanelRight } from "./icons";
import "./components/WorkspaceTopbar.css";
import { t } from "./i18n";
import { installPluginFontStyles, subscribePlugins } from "./lib/plugins";

import { NoteLinkNavigation } from "./components/NoteLinkNavigation";
import { KnowledgeTools } from "./components/KnowledgeTools";
import { WritingTools } from "./components/WritingTools";
import "./mobile.css";

function Shell() {
  const s = useStore();
  useEffect(() => {
    const refreshFonts=()=>void loadFontResources().catch(()=>{});
    refreshFonts();
    window.addEventListener("inkism-sync-check",refreshFonts);
    installPluginFontStyles();
    const unsubscribe=subscribePlugins(installPluginFontStyles);
    return ()=>{unsubscribe();window.removeEventListener("inkism-sync-check",refreshFonts);};
  }, []);
  const [navigation, setNavigation] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(() => {
    try {
      return innerWidth >= 1280 && localStorage.getItem("inkism.inspector") !== "false";
    } catch {
      return innerWidth >= 1280;
    }
  });
  const [commandsOpen, setCommandsOpen] = useState(false);
  const latest=useRef(s);latest.current=s;
  const recentNotes=useRef<string[]>([]);
  useEffect(()=>{if(s.selectedId)recentNotes.current=[s.selectedId,...recentNotes.current.filter(id=>id!==s.selectedId)].slice(0,20);},[s.selectedId]);
  useEffect(()=>registerCommands([
    {id:'app.new',label:t('새 노트'),run:()=>latest.current.newNote(),shortcut:'mod+n'},
    {id:'note.timestamp',label:t('시간 코드 제목으로 새 노트'),run:()=>{const now=new Date(),pad=(v:number)=>String(v).padStart(2,'0');latest.current.newNote(`${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`,true);}},
    {id:'note.random',label:t('무작위 노트 열기'),run:async()=>{if(!await latest.current.flushNow())return;const state=latest.current,v=state.view;const result=await api.randomNote({view:v.type==='tag'||v.type==='notebook'?'all':v.type,...(v.type==='tag'?{tag:v.name}:{}),...(v.type==='notebook'?{notebook_id:v.id}:{}),query:state.search,current_id:state.selectedId,recent_ids:recentNotes.current});if(result.id)await latest.current.selectNote(result.id);else await latest.current.showError(t('무작위 노트 열기'),t('열 수 있는 노트가 없습니다.'));}},
    {id:'app.save',label:t('지금 저장'),run:async()=>{if(await latest.current.flushNow())await flushWorkspaceForClose();},shortcut:'mod+s'},
    {id:'tags.history',label:t('태그 변경 기록'),run:()=>requestTagChange()},
    {id:'app.commands',label:t('명령창 열기'),run:()=>setCommandsOpen(true),shortcut:'mod+shift+p'},
    {id:'app.settings',label:t('설정 열기'),run:()=>window.dispatchEvent(new Event('inkism-open-settings'))},
    {id:'app.search',label:t('노트 검색'),run:()=>window.dispatchEvent(new Event('inkism-open-search'))},
    {id:'app.split',label:t('분할 편집 열기'),enabled:()=>Boolean(latest.current.note),run:()=>window.dispatchEvent(new Event('inkism-open-split'))},
  ]),[]);
  useEffect(()=>listenCommandShortcuts(e=>void latest.current.showError(t('명령 실행'),String(e))),[]);
  const editorFocus = useRef<HTMLElement | null>(null);
  const openInspector = () => {
    editorFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setInspectorOpen(true);
    try {
      localStorage.setItem("inkism.inspector", "true");
    } catch {}
  };
  const closeInspector = () => {
    const previous = document.activeElement;
    setInspectorOpen(false);
    try {
      localStorage.setItem("inkism.inspector", "false");
    } catch {}
    requestAnimationFrame(() => {
      const target = editorFocus.current;
      if (target?.isConnected && (document.activeElement === previous || document.activeElement === document.body))
        target.focus({ preventScroll: true });
    });
  };
  useEffect(() => setNavigation(false), [s.view]);
  return (
    <div
      className={"app" + (s.selectedId ? " has-selection" : "") + (navigation ? " navigation-open" : "")}
      data-theme-wrapper="true"
    >
      <header className="mobile-header">
        {s.selectedId ? (
          <button aria-label={t("노트 목록으로 돌아가기")} onClick={() => void s.selectNote(null)}>
            <ArrowLeft size={21} />
          </button>
        ) : (
          <button aria-label={navigation ? t("탐색 닫기") : t("탐색 열기")} onClick={() => setNavigation(!navigation)}>
            {navigation ? <X size={21} /> : <Menu size={21} />}
          </button>
        )}
        <strong>inkism</strong>
      </header>
      {s.connError && (
        <div className="conn-banner" role="alert">
          {t("노트 엔진에 연결할 수 없습니다: {error}", { error: s.connError })}
          <button type="button" className="btn btn-small" onClick={s.retryConnection}>
            {t("다시 시도")}
          </button>
        </div>
      )}
      <NoteLinkNavigation />
      <DueReminders />
      <div className="library-tools" aria-label={t("라이브러리 도구")}><WritingTools /><KnowledgeTools /><LibraryMoreTools /><Whiteboard /></div>
      <div className="app-row">
        <Sidebar />
        <NoteList />
        <div className="workspace-column">
          <header className="workspace-topbar" aria-label={t("노트 상단바")} data-tauri-drag-region="deep">
            <NoteTabs />
            <IconButton className="topbar-new-note" label={t("새 노트 만들기")} onClick={()=>s.newNote()}>
              <Plus size={15} aria-hidden />
            </IconButton>
            <div className="workspace-topbar-actions" data-tauri-drag-region="false">
              <IconButton label={t("분할 편집 열기")} disabled={!s.note} onClick={()=>window.dispatchEvent(new Event("inkism-open-split"))}><PanelRight size={15} aria-hidden /></IconButton>
              <IconButton label={t("명령창 열기")} onClick={() => setCommandsOpen(true)}>
                <Terminal size={16} />
              </IconButton>
              <IconButton
                label={inspectorOpen ? t("노트 속성 닫기") : t("노트 속성 열기")}
                active={inspectorOpen}
                disabled={!s.draft}
                aria-expanded={inspectorOpen}
                aria-controls="note-inspector"
                onMouseDown={(event) => event.preventDefault()}
                onClick={inspectorOpen ? closeInspector : openInspector}
              >
                <PanelRight size={15} aria-hidden />
              </IconButton>
            </div>
            <WindowControls />
          </header>
          <SplitWorkspace inspectorOpen={inspectorOpen} openInspector={openInspector} closeInspector={closeInspector} />
        </div>
      </div>
      <StatusBar />
      <PreviewExport hiddenTrigger />
      <CommandPalette open={commandsOpen} onClose={() => setCommandsOpen(false)} />
      <DialogHost />
      <TagChangeDialog />
    </div>
  );
}
export default function App() {
  return (
    <SecurityBoundary>
      <StoreProvider>
        <Shell />
      </StoreProvider>
    </SecurityBoundary>
  );
}
