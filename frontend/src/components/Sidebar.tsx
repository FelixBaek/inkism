import { t } from "../i18n";
import { WebReaderDialog } from "./WebReaderDialog";
import { WebClipperDialog } from "./WebClipperDialog";
import { SettingsDialog } from "./SettingsDialog";
import React, { useEffect, useState } from "react";
import {
  FileText,
  Notebook as NotebookIcon,
  Star,
  Tag as TagIcon,
  Archive,
  Trash2,
  Plus,
  MoreVertical,
  Pencil,
  RefreshCw,
  House,
  Hash,
  Search,
  ChevronDown,
  ChevronRight,
} from "../icons";
import { useStore, type StoreValue } from "../store";
import type { Notebook, View } from "../types";
import { Menu } from "./Menu";
import { IconButton } from "./IconButton";
import "./Sidebar.css";

type SideTab = "menu" | "notebooks" | "tags";
const tabOf = (v: View): SideTab => {
  if (v.type === "notebook") return "notebooks";
  return v.type === "tag" ? "tags" : "menu";
};

function isActive(current: View, v: View): boolean {
  if (current.type !== v.type) return false;
  if (current.type === "notebook" && v.type === "notebook") return current.id === v.id;
  if (current.type === "tag" && v.type === "tag") return current.name === v.name;
  return true;
}

export function Sidebar() {
  const s = useStore();

  const navItem = (v: View, label: string, icon: React.ReactNode, count?: number) => (
    <button
      type="button"
      className={`side-item ${isActive(s.view, v) ? "is-active" : ""}`}
      onClick={() => s.setView(v)}
      aria-current={isActive(s.view, v) ? "page" : undefined}
    >
      <span className="side-icon" aria-hidden>
        {icon}
      </span>
      <span className="side-label">{label}</span>
      {count !== undefined && count > 0 && <span className="side-count">{count}</span>}
    </button>
  );

  // Felix DS: 위쪽 탭(메뉴·노트북·태그) 중 하나만 펼친다. 다른 곳에서 노트북·태그 보기로 바뀌면 그 탭으로 따라간다.
  const [tab, setTab] = useState<SideTab>(() => tabOf(s.view));
  useEffect(() => setTab(tabOf(s.view)), [s.view]);
  const tabs: { id: SideTab; label: string; icon: React.ReactNode }[] = [
    { id: "menu", label: t("메뉴"), icon: <House size={16} aria-hidden /> },
    { id: "notebooks", label: t("노트북"), icon: <NotebookIcon size={16} aria-hidden /> },
    { id: "tags", label: t("태그"), icon: <Hash size={16} aria-hidden /> },
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

  return (
    <nav className="sidebar" aria-label={t("탐색")}>
      <div className="side-brand" data-tauri-drag-region="deep">
        <span>inkism</span>
        <IconButton label={t("노트 검색 열기")} onClick={() => window.dispatchEvent(new Event("inkism-open-search"))}>
          <Search size={16} />
        </IconButton>
        <IconButton label={t("새 노트 만들기")} onClick={()=>s.newNote()}>
          <Plus size={16} />
        </IconButton>
      </div>
      <div className="side-tabs">
        <div role="tablist" aria-label={t("탐색 구분")} style={{ display: "flex", gap: 4 }}>
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
              title={tag.label}
              aria-label={tag.label}
              onClick={() => setTab(tag.id)}
              onKeyDown={onTabKey}
            >
              {tag.icon}
            </button>
          ))}
        </div>
        {tab === "notebooks" && (
          <span className="side-tabs-actions">
            <IconButton label={t("새 노트북 만들기")} onClick={() => void s.addNotebook()}>
              <Plus size={16} aria-hidden />
            </IconButton>
          </span>
        )}
      </div>
      <div className="side-scroll" role="tabpanel" id="side-tabpanel" aria-labelledby={`side-tab-${tab}`}>
        {tab === "menu" && (
          <div className="side-group">
            {navItem({ type: "all" }, t("노트"), <FileText size={16} />, s.stats?.notes)}
            {navItem({ type: "favorites" }, t("즐겨찾기"), <Star size={16} />, s.stats?.favorites)}
            {navItem({ type: "archive" }, t("보관함"), <Archive size={16} />, s.stats?.archive)}
            {navItem({ type: "trash" }, t("휴지통"), <Trash2 size={16} />, s.stats?.trash)}
            {(s.notebooks.length > 0 || s.tags.length > 0) && <div className="side-heading">{t("바로가기")}</div>}
            {s.notebooks.slice(0, 2).map((nb) => (
              <React.Fragment key={nb.id}>
                {navItem({ type: "notebook", id: nb.id }, nb.name, <NotebookIcon size={16} />)}
              </React.Fragment>
            ))}
            {s.tags.slice(0, 1).map((tag) => (
              <React.Fragment key={tag.name}>
                {navItem({ type: "tag", name: tag.name }, tag.name, <Hash size={16} />)}
              </React.Fragment>
            ))}
          </div>
        )}

        {tab === "notebooks" && (
          <fieldset className="side-group plain-fieldset" aria-labelledby="side-notebooks">
            <div className="side-heading" id="side-notebooks">
              <span>{t("노트북 {n}", { n: s.notebooks.length })}</span>
            </div>
            {s.notebooks.length === 0 && <p className="side-empty">{t("노트북이 없습니다")}</p>}
            <NotebookTree store={s} />
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
                  <span className="side-icon" aria-hidden>
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
        <WebReaderDialog />
        <WebClipperDialog />
        <SettingsDialog />
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

/** 하위 노트북은 parent_id로 들여쓰고 접는다. 부모가 없거나 순환이면 맨 위에 둔다. */
function NotebookTree({ store }: Readonly<{ store: StoreValue }>) {
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
  depth,
  tree,
  expanded,
  onToggle,
}: Readonly<{
  nb: Notebook;
  store: StoreValue;
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
          aria-label={t("{name} 하위 노트북 {action}", { name: nb.name, action: expanded ? t("접기") : t("펼치기") })}
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
        <span className="side-icon" aria-hidden style={nb.color ? { color: nb.color } : undefined}>
          <NotebookIcon size={16} />
        </span>
        <span className="side-label">{nb.name}</span>
      </button>
      <Menu
        buttonLabel={t("노트북 {name} 옵션", { name: nb.name })}
        icon={<MoreVertical size={14} aria-hidden />}
        items={[
          {
            label: t("이름 변경"),
            icon: <Pencil size={14} aria-hidden />,
            onSelect: () => void store.renameNotebook(nb),
          },
          {
            label: t("하위 노트북 만들기"),
            icon: <Plus size={14} aria-hidden />,
            onSelect: () => void store.addNotebook(nb),
          },
          {
            label: store.defaults.notebook_id === nb.id ? t("기본 노트북 해제") : t("기본 노트북으로 설정"),
            icon: <NotebookIcon size={14} aria-hidden />,
            onSelect: () => store.toggleDefaultNotebook(nb),
          },
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
