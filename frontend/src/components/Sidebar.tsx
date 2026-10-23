import { t } from "../i18n";
import { WebClipperDialog } from "./WebClipperDialog";
import { SettingsDialog } from "./SettingsDialog";
import React, { useEffect, useState } from "react";
import {
  FileText,
  Folder,
  Star,
  Tag as TagIcon,
  Archive,
  Trash2,
  Plus,
  MoreVertical,
  Pencil,
  RefreshCw,
  Files,
  Bell,
  Link2,
  Hash,
  Search,
  ChevronDown,
  ChevronRight,
} from "../icons";
import { useStore, type StoreValue } from "../store";
import type { Notebook, View } from "../types";
import { Menu } from "./Menu";
import { CalendarBlankIcon } from "@phosphor-icons/react";
import { KNOWLEDGE_EVENT } from "./KnowledgeTools";
import { SyncIndicator } from "./SyncSettings";
import { WRITING_TOOL_EVENT } from "./WritingTools";
import type { ShellPanel } from "./ShellLists";
import { useNarrow } from "../lib/narrow";
import { api } from "../api";
import { IconButton } from "./IconButton";
import { colorMenu, iconMenu, NotebookGlyph } from "./LibraryStyle";
import "./Sidebar.css";

type SideTab = "menu" | "notebooks" | "tags";
const tabOf = (v: View): SideTab => {
  if (v.type === "notebook") return "notebooks";
  return v.type === "tag" ? "tags" : "menu";
};

function isActive(current: View, v: View): boolean {
  if (current.type === "trash" && v.type === "archive") return true;
  if (current.type !== v.type) return false;
  if (current.type === "notebook" && v.type === "notebook") return current.id === v.id;
  if (current.type === "tag" && v.type === "tag") return current.name === v.name;
  return true;
}

export function Sidebar({
  panel,
  onPanel,
  onDaily,
}: Readonly<{ panel: ShellPanel | null; onPanel: (panel: ShellPanel) => void; onDaily: () => void }>) {
  const s = useStore();
  const narrow = useNarrow();

  const navItem = (v: View, label: string, icon: React.ReactNode, count?: number) => (
    <button
      type="button"
      className={`side-item ${!panel && isActive(s.view, v) ? "is-active" : ""}`}
      onClick={() => s.setView(v)}
      aria-current={!panel && isActive(s.view, v) ? "page" : undefined}
    >
      <span className="side-icon" aria-hidden>
        {icon}
      </span>
      <span className="side-label">{label}</span>
      {count !== undefined && count > 0 && <span className="side-count">{count}</span>}
    </button>
  );

  // 위쪽 탭(메뉴·폴더·태그) 중 하나만 펼친다. 다른 곳에서 폴더·태그 보기로 바뀌면 그 탭으로 따라간다.
  const [tab, setTab] = useState<SideTab>(() => tabOf(s.view));
  useEffect(() => setTab(tabOf(s.view)), [s.view]);
  const tabs: { id: SideTab; label: string }[] = [
    { id: "menu", label: t("메뉴") },
    { id: "notebooks", label: t("폴더") },
    { id: "tags", label: t("태그") },
  ];
  const onTabKey = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((tag) => tag.id === tab);
    let next: number;
    if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (i + tabs.length - 1) % tabs.length;
    else return;
    e.preventDefault();
    setTab(tabs[next].id);
    e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };
  const toolItem = (label: string, icon: React.ReactNode, run: () => void, active = false) => (
    <button
      type="button"
      className={`side-item ${active ? "is-active" : ""}`}
      aria-current={active ? "page" : undefined}
      onClick={run}
    >
      <span className="side-icon" aria-hidden>
        {icon}
      </span>
      <span className="side-label">{label}</span>
    </button>
  );
  // 폴더 탭을 열 때와 노트 수가 바뀔 때(stats) 폴더별 개수를 다시 읽는다.
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    if (tab !== "notebooks") return;
    let live = true;
    api
      .notebookCounts()
      .then((value) => live && setCounts(value))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [tab, s.stats, s.notebooks]);
  const openKnowledge = (panel: "graph") =>
    window.dispatchEvent(new CustomEvent(KNOWLEDGE_EVENT, { detail: panel }));

  return (
    <nav className="sidebar" aria-label={t("탐색")}>
      <div className="side-brand" data-tauri-drag-region="deep">
        <span className="side-brand-dot" aria-hidden />
        <span className="side-brand-name">inkism</span>
      </div>
      <button
        type="button"
        className="side-search"
        aria-label={t("노트 검색 열기")}
        onClick={() => window.dispatchEvent(new Event("inkism-open-search"))}
      >
        <Search size={16} aria-hidden />
        <span>{t("노트 검색")}</span>
        <kbd>{/Mac|iP/.test(navigator.platform) ? "⌘ P" : "Ctrl P"}</kbd>
      </button>
      <button type="button" className="side-new-note" onClick={() => s.newNote()}>
        {t("새 노트")}
      </button>
      <button type="button" className="side-search" onClick={() => window.dispatchEvent(new Event("inkism-quick-capture"))}>{t("빠른 기록")}</button>
      <div className="side-tabs">
        <div role="tablist" aria-label={t("탐색 구분")} className="side-tablist">
          {tabs.map((tag) => (
            <button
              key={tag.id}
              type="button"
              role="tab"
              id={`side-tab-${tag.id}`}
              aria-controls="side-tabpanel"
              aria-selected={tab === tag.id}
              tabIndex={tab === tag.id ? 0 : -1}
              className="side-tab"
              onClick={() => setTab(tag.id)}
              onKeyDown={onTabKey}
            >
              {tag.label}
            </button>
          ))}
        </div>
      </div>
      <div className="side-scroll" role="tabpanel" id="side-tabpanel" aria-labelledby={`side-tab-${tab}`}>
        {tab === "menu" && (
          <div className="side-group">
            {navItem({ type: "all" }, t("전체 노트"), <FileText size={16} />, s.stats?.notes)}
            {navItem({ type: "favorites" }, t("즐겨찾기"), <Star size={16} />, s.stats?.favorites)}
            {/* 지운 노트는 보관함 화면의 탭이다(Figma 07·08). */}
            {navItem({ type: "archive" }, t("보관함"), <Archive size={16} />, (s.stats?.archive ?? 0) + (s.stats?.trash ?? 0))}
            <hr className="side-divider" />
            {toolItem(t("오늘의 노트"), <CalendarBlankIcon size={16} />, onDaily, panel === "daily")}
            {toolItem(t("템플릿"), <Files size={16} />, () =>
              window.dispatchEvent(new CustomEvent(WRITING_TOOL_EVENT, { detail: "templates" })),
            )}
            {toolItem(t("관계 그래프"), <Link2 size={16} />, () => openKnowledge("graph"))}
          </div>
        )}

        {tab === "notebooks" && (
          <fieldset className="side-group plain-fieldset" aria-labelledby="side-notebooks">
            <div className="side-heading" id="side-notebooks">
              <span>{t("폴더 {n}", { n: s.notebooks.length })}</span>
              <IconButton label={t("새 폴더 만들기")} onClick={() => void s.addNotebook()}>
                <Plus size={14} aria-hidden />
              </IconButton>
            </div>
            {s.notebooks.length === 0 && <p className="side-empty">{t("폴더가 없습니다")}</p>}
            <NotebookTree store={s} counts={counts} />
          </fieldset>
        )}
        {tab === "tags" && (
          <fieldset className="side-group plain-fieldset" aria-labelledby="side-tags">
            <div className="side-heading" id="side-tags">
              <span>{t("태그 {n}", { n: s.tags.length })}</span>
            </div>
            {s.tags.length === 0 && <p className="side-empty">{t("태그가 없습니다")}</p>}
            {s.tags.map((tag) => (
              <div
                key={tag.name}
                className={`side-row ${isActive(s.view, { type: "tag", name: tag.name }) ? "is-active" : ""}`}
              >
                <button
                  type="button"
                  className={`side-item ${isActive(s.view, { type: "tag", name: tag.name }) ? "is-active" : ""}`}
                  onClick={() => s.setView({ type: "tag", name: tag.name })}
                  aria-current={isActive(s.view, { type: "tag", name: tag.name }) ? "page" : undefined}
                >
                  <span className="side-icon" aria-hidden style={tag.color ? { color: tag.color } : undefined}>
                    <Hash size={16} />
                  </span>
                  <span className="side-label">{tag.name}</span>
                  <span className="side-count">{tag.count}</span>
                </button>
                <Menu
                  buttonLabel={t("태그 {name} 옵션", { name: tag.name })}
                  icon={<MoreVertical size={14} aria-hidden />}
                  items={[
                    {
                      label: t("이름 변경"),
                      icon: <Pencil size={14} aria-hidden />,
                      onSelect: () => void s.renameTag(tag.name),
                    },
                    {
                      label: s.defaults.tag === tag.name ? t("기본 태그 해제") : t("기본 태그로 설정"),
                      icon: <TagIcon size={14} aria-hidden />,
                      onSelect: () => s.toggleDefaultTag(tag.name),
                    },
                    colorMenu(tag.color, (color) => void s.setTagColor(tag.name, color)),
                    {
                      label: t("태그 제거"),
                      icon: <Trash2 size={14} aria-hidden />,
                      danger: true,
                      onSelect: () => void s.removeTag(tag.name),
                    },
                  ]}
                />
              </div>
            ))}
          </fieldset>
        )}
      </div>

      <div className="side-footer">
        {toolItem(t("알림"), <Bell size={16} />, () => onPanel("reminders"), panel === "reminders")}
        <WebClipperDialog />
        <SettingsDialog />
        <hr className="side-divider" />
        {!narrow && (
          <div className="side-sync">
            <SyncIndicator />
          </div>
        )}
        {s.connError && (
          <div className="side-appinfo" aria-label={t("앱 정보")}>
            <button type="button" className="conn-error" onClick={s.retryConnection}>
              <RefreshCw size={12} aria-hidden /> {t("엔진 연결 실패 — 다시 시도")}
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}

/** 하위 폴더는 parent_id로 들여쓰고 접는다. 부모가 없거나 순환이면 맨 위에 둔다. */
function NotebookTree({ store, counts }: Readonly<{ store: StoreValue; counts: Record<string, number> }>) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const ids = new Set(store.notebooks.map((n) => n.id));
  const children = new Map<string | null, Notebook[]>();
  for (const nb of store.notebooks) {
    const parent = nb.parent_id && ids.has(nb.parent_id) && nb.parent_id !== nb.id ? nb.parent_id : null;
    children.set(parent, [...(children.get(parent) ?? []), nb]);
  }
  const nested = children.size > 1;
  const rows: React.ReactNode[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number, visible: boolean) => {
    for (const nb of children.get(parent) ?? []) {
      if (seen.has(nb.id)) continue;
      seen.add(nb.id);
      const kids = children.get(nb.id)?.length ?? 0;
      const open = !collapsed.has(nb.id);
      if (visible)
        rows.push(
          <NotebookRow
            key={nb.id}
            nb={nb}
            store={store}
            count={counts[nb.id]}
            depth={depth}
            tree={nested}
            expanded={kids ? open : undefined}
            onToggle={() =>
              setCollapsed((cur) => {
                const next = new Set(cur);
                if (next.has(nb.id)) next.delete(nb.id);
                else next.add(nb.id);
                return next;
              })
            }
          />,
        );
      walk(nb.id, depth + 1, visible && open);
    }
  };
  walk(null, 0, true);
  // Cycles never reach the root; still list them instead of hiding notebooks.
  for (const nb of store.notebooks)
    if (!seen.has(nb.id)) rows.push(<NotebookRow key={nb.id} nb={nb} store={store} depth={0} onToggle={() => {}} />);
  return <>{rows}</>;
}

function NotebookRow({
  nb,
  store,
  count,
  depth,
  tree,
  expanded,
  onToggle,
}: Readonly<{
  nb: Notebook;
  store: StoreValue;
  count?: number;
  depth: number;
  tree?: boolean;
  expanded?: boolean;
  onToggle: () => void;
}>) {
  const active = store.view.type === "notebook" && store.view.id === nb.id;
  return (
    <div className={`side-row ${active ? "is-active" : ""}`} style={depth ? { paddingLeft: depth * 14 } : undefined}>
      {expanded === undefined ? (
        tree && <span className="side-caret" aria-hidden />
      ) : (
        <button
          type="button"
          className="side-caret"
          aria-label={t("{name} 하위 폴더 {action}", { name: nb.name, action: expanded ? t("접기") : t("펼치기") })}
          aria-expanded={expanded}
          onClick={onToggle}
        >
          {expanded ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
        </button>
      )}
      <button
        type="button"
        className="side-item"
        onClick={() => store.setView({ type: "notebook", id: nb.id })}
        aria-current={active ? "page" : undefined}
      >
        <span className="side-icon" aria-hidden>
          <NotebookGlyph nb={nb} />
        </span>
        <span className="side-label">{nb.name}</span>
        {!!count && <span className="side-count">{count}</span>}
      </button>
      <Menu
        buttonLabel={t("폴더 {name} 옵션", { name: nb.name })}
        icon={<MoreVertical size={14} aria-hidden />}
        items={[
          {
            label: t("이름 변경"),
            icon: <Pencil size={14} aria-hidden />,
            onSelect: () => void store.renameNotebook(nb),
          },
          {
            label: t("하위 폴더 만들기"),
            icon: <Plus size={14} aria-hidden />,
            onSelect: () => void store.addNotebook(nb),
          },
          {
            label: store.defaults.notebook_id === nb.id ? t("기본 폴더 해제") : t("기본 폴더로 설정"),
            icon: <Folder size={14} aria-hidden />,
            onSelect: () => store.toggleDefaultNotebook(nb),
          },
          colorMenu(nb.color, (color) => void store.styleNotebook(nb, { color })),
          iconMenu(nb, (icon) => void store.styleNotebook(nb, { icon })),
          {
            label: t("삭제"),
            icon: <Trash2 size={14} aria-hidden />,
            danger: true,
            onSelect: () => void store.removeNotebook(nb),
          },
        ]}
      />
    </div>
  );
}
