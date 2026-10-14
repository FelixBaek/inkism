import {TagChangeDialog} from "./components/TagChangeDialog";
import {requestTagChange} from "./lib/tag-change";
import { api, rpc } from "./api";
import { DailyList, ReminderBanner, ReminderList, type ShellPanel } from "./components/ShellLists";
import { localDate, localTime } from "./lib/writing-tools";
import { defaultEditor } from "./lib/editor-settings";
import {flushWorkspaceForClose} from "./lib/workspace";
import {Whiteboard} from "./components/Whiteboard";
import {LibraryMoreTools} from "./components/LibraryMoreTools";
import {loadFontResources} from "./lib/font-resources";
import {registerCommands,listenCommandShortcuts} from "./lib/app-commands";
import React, { useEffect, useRef, useState } from "react";
import { startSemanticIndexer } from "./lib/semantic-index";
import { restoreAIKey } from "./lib/ai-provider";
import { SecurityBoundary } from "./components/AppSecurity";
import { StoreProvider, useStore, viewTitle } from "./store";
import { Sidebar } from "./components/Sidebar";
import { NoteList } from "./components/NoteList";
import { SplitWorkspace } from "./components/SplitWorkspace";
import { DueReminders } from "./components/Reminders";
import { DialogHost } from "./components/DialogHost";
import { StatusBar } from "./components/EditorPane";
import { CommandPalette } from "./components/CommandPalette";
import { DotsThreeIcon } from "@phosphor-icons/react";
import { NotebookGlyph } from "./components/LibraryStyle";
import { Menu as MenuButton, type MenuItemSpec } from "./components/Menu";
import { NoteShareDialog } from "./components/NoteShareDialog";
import { NoteTabs } from "./components/NoteTabs";
import { PreviewExport } from "./components/PreviewExport";
import { IconButton } from "./components/IconButton";
import { WindowControls } from "./components/WindowControls";
import { Menu, ArrowLeft, X, PanelRight, History, Bell, Plus, Pencil, ListDashes, BookOpenText, Archive, Trash2, Columns, ShareExport } from "./icons";
import { renameNoteDialog } from "./components/NoteContextMenu";
import { DeletedToast } from "./components/DeletedToast";
import "./components/WorkspaceTopbar.css";
import { t } from "./i18n";
import { installPluginFontStyles, subscribePlugins } from "./lib/plugins";

import { NoteLinkNavigation } from "./components/NoteLinkNavigation";
import { KnowledgeTools } from "./components/KnowledgeTools";
import { WritingTools } from "./components/WritingTools";
import { WikiUpdate } from "./components/WikiUpdate";
import "./mobile.css";

type ShellStore = ReturnType<typeof useStore>;
function notebookPath(note: ShellStore["note"], notebooks: ShellStore["notebooks"]) {
  const path: string[] = [];
  const seen = new Set<string>();
  for (let id = note?.notebook_id ?? null; id && !seen.has(id); ) {
    seen.add(id);
    const notebook = notebooks.find((n) => n.id === id);
    if (!notebook) break;
    path.unshift(notebook.name);
    id = notebook.parent_id ?? null;
  }
  return path;
}
function shellViewName(panel: ShellPanel | null, view: ShellStore["view"], notebooks: ShellStore["notebooks"]) {
  if (panel === "reminders") return t("알림");
  if (panel === "daily") return t("오늘의 노트");
  if (view.type === "notebook") return notebooks.find((n) => n.id === view.id)?.name ?? t("폴더");
  return viewTitle(view);
}
function mobileTitle(selected: boolean, path: string[], navigation: boolean, viewName: string) {
  if (selected) return path.at(-1) ?? "inkism";
  return navigation ? "inkism" : viewName;
}
function ShellNoteList({ panel }: Readonly<{ panel: ShellPanel | null }>) {
  if (panel === "reminders") return <ReminderList />;
  if (panel === "daily") return <DailyList />;
  return <NoteList />;
}

function shellClassName(selected: boolean, navigation: boolean) {
  return "app" + (selected ? " has-selection" : "") + (navigation ? " navigation-open" : "");
}

function Shell() {
  const s = useStore();
  useEffect(() => {
    const refreshFonts=()=>void loadFontResources().catch(()=>{});
    refreshFonts();
    window.addEventListener("inkism-sync-check",refreshFonts);
    installPluginFontStyles();
    const unsubscribe=subscribePlugins(installPluginFontStyles);
    void restoreAIKey();
    const stopSemantic=startSemanticIndexer();
    return ()=>{unsubscribe();stopSemantic();window.removeEventListener("inkism-sync-check",refreshFonts);};
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
  // F2: 열린 노트 이름 바꾸기(목록 행에서는 그 행의 노트).
  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if(e.key!=='F2'||e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey||e.shiftKey||document.querySelector('dialog[open]'))return;const st=latest.current,n=st.note;if(!n||n.trashed)return;e.preventDefault();void renameNoteDialog(st,n.id,st.draft?.id===n.id?st.draft.title:n.title);};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[]);
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
  // 받은 알림·오늘의 노트는 노트 목록 자리를 잠시 대신한다. 다른 목록을 고르면 닫힌다.
  const [panel, setPanel] = useState<ShellPanel | null>(null);
  useEffect(() => {
    setNavigation(false);
    setPanel(null);
  }, [s.view]);
  const showPanel = (next: ShellPanel) => {
    setPanel(next);
    setNavigation(false);
  };
  const openDaily = async () => {
    showPanel("daily");
    try {
      if (!(await latest.current.flushNow())) return;
      const now = new Date();
      const note = await rpc<{ id: string }>("daily_note", { date: localDate(now), time: localTime(now), content_format: defaultEditor() });
      latest.current.refreshList();
      await latest.current.refreshMeta();
      await latest.current.selectNote(note.id);
    } catch (e) {
      await latest.current.showError(t("오늘의 노트"), String(e));
    }
  };
  const [sharing, setSharing] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const tools = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!toolsOpen) return;
    // 도구가 연 대화상자 안의 클릭·Esc는 그 대화상자 몫이다. 패널을 남겨 두어야 닫힌 뒤 초점이 단추로 돌아온다.
    const close = (e: Event) => {
      if (document.querySelector("dialog[open]")) return;
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !tools.current?.contains(e.target as Node)) setToolsOpen(false);
    };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", close);
    };
  }, [toolsOpen]);
  // 상단 경로: 열린 노트의 폴더를 상위부터 잇는다. 노트가 없으면 지금 보는 목록 이름.
  const path = notebookPath(s.note, s.notebooks);
  const viewName = shellViewName(panel, s.view, s.notebooks);
  const topbarId = path.length ? s.note?.notebook_id : s.view.type === "notebook" ? s.view.id : null;
  const topbarNotebook = s.notebooks.find((n) => n.id === topbarId);
  const inspectorLabel = inspectorOpen ? t("노트 속성 닫기") : t("노트 속성 열기");
  // 노트 메뉴 통일(Figma 44 "노트 메뉴"): 목록 우클릭 메뉴와 같은 이름 바꾸기·보관·지우기를 둔다.
  const open = s.note && !s.note.trashed ? s.note : null;
  const moreItems = (compact: boolean): MenuItemSpec[] => [
    ...(compact ? [{ label: t("공유"), icon: <ShareExport size={15} aria-hidden />, disabled: !s.note, onSelect: () => setSharing(true) }] : []),
    { label: t("분할 편집 열기"), icon: <Columns size={15} aria-hidden />, disabled: !s.note, onSelect: () => window.dispatchEvent(new Event("inkism-open-split")) },
    {
      label: t("이름 바꾸기"),
      icon: <Pencil size={15} aria-hidden />,
      shortcut: "F2",
      disabled: !open,
      onSelect: () => open && void renameNoteDialog(s, open.id, s.draft?.id === open.id ? s.draft.title : open.title),
    },
    { label: t("명령창 열기"), icon: <ListDashes size={15} aria-hidden />, onSelect: () => setCommandsOpen(true) },
    ...(compact ? [] : [{ label: inspectorLabel, icon: <History size={15} aria-hidden />, separatorBefore: true, disabled: !s.draft, onSelect: inspectorOpen ? closeInspector : openInspector }]),
    { label: t("라이브러리 도구"), icon: <BookOpenText size={15} aria-hidden />, separatorBefore: compact, onSelect: () => setToolsOpen(true) },
    {
      label: t("보관"),
      icon: <Archive size={15} aria-hidden />,
      separatorBefore: true,
      checked: Boolean(open?.archived),
      disabled: !open,
      onSelect: () => open && void s.patchNoteById(open.id, { archived: !open.archived }),
    },
    {
      label: t("지우기"),
      icon: <Trash2 size={15} aria-hidden />,
      shortcut: "Del",
      danger: true,
      disabled: !open,
      onSelect: () => open && void s.trashSelected(),
    },
  ];
  return (
    <div
      className={shellClassName(Boolean(s.selectedId), navigation)}
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
        <strong>{mobileTitle(Boolean(s.selectedId), path, navigation, viewName)}</strong>
        {s.selectedId ? (
          <IconButton label={inspectorLabel} active={inspectorOpen} disabled={!s.draft} onClick={inspectorOpen ? closeInspector : openInspector}>
            <PanelRight size={18} aria-hidden />
          </IconButton>
        ) : null}
        <MoreMenu items={moreItems(true)} />
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
      <div className="app-row">
        <Sidebar panel={panel} onPanel={showPanel} onDaily={() => void openDaily()} />
        <div className="app-main">
          <header className="app-topbar" aria-label={t("노트 상단바")} data-tauri-drag-region="deep">
            {panel === "reminders" ? <Bell size={16} aria-hidden /> : <NotebookGlyph nb={topbarNotebook} />}
            <span className="app-topbar-path">{(panel !== "reminders" && path.length ? path : [viewName]).join("  /  ")}</span>
            <div className="app-topbar-actions" data-tauri-drag-region="false">
              <IconButton
                label={inspectorLabel}
                active={inspectorOpen}
                disabled={!s.draft}
                aria-expanded={inspectorOpen}
                aria-controls="note-inspector"
                onMouseDown={(event) => event.preventDefault()}
                onClick={inspectorOpen ? closeInspector : openInspector}
              >
                <History size={16} aria-hidden />
              </IconButton>
              <button type="button" className="app-topbar-share" disabled={!s.note} onClick={() => setSharing(true)}>
                {t("공유")}
              </button>
              <MoreMenu items={moreItems(false)} />
            </div>
            <WindowControls />
          </header>
          {/* 라이브러리 도구는 늘 붙어 있어야 단축키와 대화상자가 동작한다. 닫혀 있을 때는 보이지만 않게 둔다. */}
          <div ref={tools} className={"library-tools" + (toolsOpen ? " is-open" : "")} aria-label={t("라이브러리 도구")}>
            <WritingTools />
            <WikiUpdate />
            <KnowledgeTools />
            <LibraryMoreTools />
            <Whiteboard />
          </div>
          <div className="app-content">
            <ShellNoteList panel={panel} />
            <div className="workspace-column">
              <div className="workspace-topbar" data-tauri-drag-region="deep">
                <NoteTabs />
                <IconButton className="topbar-new-note" label={t("새 노트 만들기")} onClick={() => s.newNote()}>
                  <Plus size={16} aria-hidden />
                </IconButton>
              </div>
              <ReminderBanner />
              <SplitWorkspace inspectorOpen={inspectorOpen} openInspector={openInspector} closeInspector={closeInspector} />
            </div>
          </div>
          <StatusBar />
        </div>
      </div>
      {sharing && s.note && <NoteShareDialog noteID={s.note.id} onClose={() => setSharing(false)} />}
      <PreviewExport hiddenTrigger />
      <CommandPalette open={commandsOpen} onClose={() => setCommandsOpen(false)} />
      <DialogHost />
      <DeletedToast />
      <TagChangeDialog />
    </div>
  );
}

function MoreMenu({ items }: Readonly<{ items: MenuItemSpec[] }>) {
  return <MenuButton buttonLabel={t("노트 메뉴")} icon={<DotsThreeIcon size={16} aria-hidden />} items={items} />;
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
