import {commandHistory,recordCommand,toggleCommandFavorite,clearCommandHistory,COMMAND_HISTORY_CHANGED} from "../lib/command-history";
import {appCommands,COMMANDS_CHANGED} from "../lib/app-commands";
import { t } from "../i18n";
import React, { useEffect, useRef, useState } from "react";
import { ArrowElbowDownLeftIcon as ArrowElbowDownLeft } from "@phosphor-icons/react";
import { X, ChevronRight, Check, Eye } from "../icons";
import { useStore } from "../store";
import { useNoteCommands } from "./NoteContextMenu";
import type { MenuItemSpec } from "./Menu";
import { ReminderEditor } from "./Reminders";
import { NoteShareDialog } from "./NoteShareDialog";
import { PREVIEW_EVENT } from "./PreviewExport";
import "./CommandPalette.css";
import { Segmented } from "./Segmented";

const LABELS: Record<string, string> = {
  "새 탭에서 열기": "Open in new tab",
  고정: "Pin",
  "읽기 전용": "Read only",
  즐겨찾기: "Favorite",
  "알림 설정": "Remind me",
  보관: "Archive",
  "폴더에 넣기": "Add to folder: Folders",
  "색 지정": "Assign color: Add color",
  태그: "Tags: Assign to...",
  인쇄: "Print",
  게시: "Publish",
  "다른 형식으로 내보내기": "Export as",
  내보내기: "Export as",
  "다른 형식으로 복사": "Copy as",
  "링크 복사": "Copy link",
  복제: "Duplicate",
  삭제: "Delete: Move to deleted notes",
};
export function CommandPalette({ open, onClose }: Readonly<{ open: boolean; onClose: () => void }>) {
  const s = useStore(),
    dialog = useRef<HTMLDialogElement>(null),
    input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState(0),
    [group, setGroup] = useState<MenuItemSpec | null>(null);
  const [action, setAction] = useState<"reminder" | "publish" | null>(null);
  const [history,setHistory]=useState(commandHistory),[filter,setFilter]=useState<"all"|"recent"|"frequent"|"favorites">("all");
  useEffect(()=>{const update=()=>setHistory(commandHistory());window.addEventListener(COMMAND_HISTORY_CHANGED,update);return()=>window.removeEventListener(COMMAND_HISTORY_CHANGED,update);},[]);
  const note = s.note;
  const [,rerender]=useState(0);
  useEffect(()=>{const changed=()=>rerender(n=>n+1);window.addEventListener(COMMANDS_CHANGED,changed);return()=>window.removeEventListener(COMMANDS_CHANGED,changed);},[]);
  const noteCommands=useNoteCommands(
      { id:"",title:"",tags:[],notebook_ids:[], ...note, preview: "" } as Parameters<typeof useNoteCommands>[0],
      () => setAction("reminder"),
      () => setAction("publish"),
    );
  const commands: MenuItemSpec[] = [
    ...appCommands().map(c=>({commandId:c.id,label:c.label,disabled:c.enabled?.()===false,onSelect:()=>void Promise.resolve().then(c.run).catch(e=>s.showError(t("명령 실행"),String(e)))})),
    ...(note?noteCommands:[]),
    {
      disabled:!note,
      commandId: "context.note.preview",
      label: t("미리보기"),
      icon: <Eye size={15} />,
      onSelect: () => {
        window.dispatchEvent(new Event(PREVIEW_EVENT));
      },
    },
  ];
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      setGroup(null);
      setFilter("all");
      dialog.current?.showModal();
      input.current?.focus();
    } else dialog.current?.close();
  }, [open]);
  const matches = (c: MenuItemSpec) =>
    (c.label + " " + (LABELS[c.label] ?? "")).toLowerCase().includes(query.toLowerCase());
  const flatten=(items:MenuItemSpec[],prefix=''):MenuItemSpec[]=>items.flatMap(c=>c.items?flatten(c.items,prefix+c.label+': '):[{...c,label:prefix+c.label}]);
  const candidates=group?.items??(query||filter!=='all'?flatten(commands):commands);
  const filtered=candidates.filter(matches).filter(c=>filter==='all'||!!c.commandId&&(filter==='favorites'?history.favorites.includes(c.commandId):!!history.usage[c.commandId]));
  if(filter==='recent'||filter==='frequent')filtered.sort((a,b)=>{
    const left=history.usage[a.commandId!]!,right=history.usage[b.commandId!]!;
    return (filter==='frequent'?right.count-left.count:0)||right.at-left.at;
  });
  else if(filter==='all'&&!query&&!group)filtered.sort((a,b)=>Number(history.favorites.includes(b.commandId??''))-Number(history.favorites.includes(a.commandId??'')));
  const active = Math.min(selected, Math.max(0, filtered.length - 1));
  const execute = (command?: MenuItemSpec) => {
    if (!command || command.disabled) return;
    if (command.items) {
      setGroup(command);
      setQuery("");
      setSelected(0);
      input.current?.focus();
      return;
    }
    dialog.current?.close();
    onClose();
    if(command.onSelect){try{command.onSelect();if(command.commandId)recordCommand(command.commandId);}catch(e){void s.showError(t("명령 실행"),String(e));}}
  };
  const quickOpen = () => {
    dialog.current?.close();
    onClose();
    window.dispatchEvent(new Event("inkism-open-search"));
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        quickOpen();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  return (
    <>
      <dialog
        ref={dialog}
        className="command-palette"
        aria-label={t("명령 검색")}
        onCancel={onClose}
        onClick={(e) => {
          if (e.target !== e.currentTarget) return;
          const r = e.currentTarget.getBoundingClientRect();
          if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose();
        }}
      >
        <div className="command-search">
          <input
            ref={input}
            aria-label={t("명령 검색어")}
            placeholder="Execute a command..."
            value={query}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-list"
            aria-activedescendant={filtered.length ? `command-${active}` : undefined}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const next =
                  (active + (e.key === "ArrowDown" ? 1 : -1) + filtered.length) % Math.max(1, filtered.length);
                setSelected(next);
                document.getElementById(`command-${next}`)?.scrollIntoView({ block: "nearest" });
              } else if (e.key === "Enter") {
                e.preventDefault();
                execute(filtered[active]);
              } else if (e.key === "Backspace" && !query && group) {
                setGroup(null);
                setSelected(0);
              }
            }}
          />
          <button className="icon-btn" aria-label={t("명령창 닫기")} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <nav className="command-filters" aria-label={t("명령 표시 범위")}>
          <Segmented label={t("명령 표시 범위")} value={filter} onChange={(value)=>{setFilter(value);setGroup(null);setSelected(0);}}
            options={([['all','전체 명령'],['favorites','즐겨찾는 명령'],['recent','최근 실행'],['frequent','자주 실행']] as const).map(([value,label])=>[value,t(label)] as const)} />
          <button className="command-clear" disabled={!Object.keys(history.usage).length} onClick={clearCommandHistory}>{t("명령 사용 기록 지우기")}</button>
        </nav>
        <div className="command-results">
          <p>
            {group ? (
              <button
                className="command-back"
                onClick={() => {
                  setGroup(null);
                  setQuery("");
                  setSelected(0);
                }}
              >
                ‹ {group.label}
              </button>
            ) : (
              <>
                Actions for note: <span>{note?.title || t("전체 명령")}</span>
              </>
            )}
          </p>
          <div id="command-list" role="listbox" aria-label={t("노트 명령")}>
            {filtered.map((c, i) => (
              <button
                key={c.commandId??c.label}
                id={`command-${i}`}
                role="option"
                aria-selected={i === active}
                aria-disabled={c.disabled || undefined}
                className={i === active ? "is-selected" : ""}
                onMouseMove={() => setSelected(i)}
                onClick={() => execute(c)}
              >
                {c.icon}
                <span>{LABELS[c.label] ?? c.label}</span>
                {history.favorites.includes(c.commandId??'')&&<span aria-label={t("즐겨찾는 명령")}>★</span>}{c.checked && <Check size={16} />} {c.items && <ChevronRight size={16} />}
              </button>
            ))}
            {!filtered.length && <p>{t("일치하는 명령이 없습니다.")}</p>}
          </div>
        </div>
        <footer>
          <button disabled={!filtered[active]?.commandId||!!filtered[active]?.items} aria-pressed={history.favorites.includes(filtered[active]?.commandId??'')} onClick={()=>{const id=filtered[active]?.commandId;if(id)toggleCommandFavorite(id);}}>{t("선택 명령 즐겨찾기")}</button>
          <button onClick={() => execute(filtered[active])} disabled={!filtered.length || filtered[active]?.disabled}>
            Execute <ArrowElbowDownLeft size={16} />
          </button>
          <button onClick={quickOpen}>
            Quick open <kbd>Ctrl+P</kbd>
          </button>
        </footer>
      </dialog>
      {note && action === "reminder" && (
        <div className="command-tools">
          <ReminderEditor
            id={note.id}
            at={note.reminder_at}
            repeatHours={note.reminder_repeat_hours}
            disabled={false}
            onClose={() => setAction(null)}
          />
        </div>
      )}
      {note && action === "publish" && <NoteShareDialog noteID={note.id} onClose={() => setAction(null)} />}
    </>
  );
}
