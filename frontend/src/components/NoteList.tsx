import React, { useState, useEffect } from "react";
import {
  Broom,
  Plus,
  Search,
  Pin,
  Trash2,
  RotateCcw,
  Star,
  ChevronLeft,
  ChevronRight,
  Loader2,
  SearchX,
  StickyNote,
  Notebook as NotebookIcon,
  Pencil,
  PencilOff,
  Archive,
} from "../icons";
import { useStore, viewTitle, PAGE_SIZE } from "../store";
import { formatRelative } from "../lib/date";
import type { Notebook, Summary, View } from "../types";
import { IconButton } from "./IconButton";
import { NoteContextMenu, type NoteMenuTarget } from "./NoteContextMenu";
import { ReminderEditor } from "./Reminders";
import { NoteShareDialog } from "./NoteShareDialog";
import { CoverBanner } from "./NotebookCover";
import { GroupHeader, useListSort } from "./NoteListSort";
import { groupItems } from "../lib/list-sort";
import { openInNewTab } from "./NoteTabs";
import "./NoteList.css";
import { t } from "../i18n";

export function NoteList() {
  const s = useStore();
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    const open = () => {
      setSearchOpen(true);
      requestAnimationFrame(() => document.getElementById("note-search")?.focus());
    };
    window.addEventListener("inkism-open-search", open);
    return () => window.removeEventListener("inkism-open-search", open);
  }, []);
  const title = s.view.type === "all" ? t("노트") : listTitle(s.view, s.notebooks);
  const notebook =
    s.view.type === "notebook" ? s.notebooks.find((n) => n.id === (s.view as { id: string }).id) : undefined;
  const [menu, setMenu] = useState<NoteMenuTarget | null>(null);
  const [action, setAction] = useState<(NoteMenuTarget & { kind: "reminder" | "publish" }) | null>(null);

  const items = s.pageData?.items ?? [];
  const hasNext = (s.pageData?.nextCursor ?? null) !== null;
  const [sort, setSort] = useListSort(s.view);
  const groups = s.search ? [{ title: "", items }] : groupItems(items, sort);
  const changeSort = (next: typeof sort) => {
    setSort(next);
    if (next.sortBy !== sort.sortBy || next.sortDirection !== sort.sortDirection) s.refreshList();
  };

  return (
    <section className="note-list" aria-label={t("노트 목록")}>
      {!notebook && (
        <div className="list-header" data-tauri-drag-region="deep">
          <h2 className="list-title">
            {title}
            <span className="list-count">{s.view.type === "all" ? s.stats?.notes : items.length}</span>
          </h2>
          <div className="list-header-actions" data-tauri-drag-region="false">
            {s.view.type === "trash" ? (
              <IconButton
                label={t("휴지통 비우기")}
                onClick={() => void s.emptyTrash()}
                disabled={items.length === 0 && s.page === 1}
              >
                <Broom size={16} aria-hidden />
              </IconButton>
            ) : (
              <GroupHeader title="" sort={sort} onSort={changeSort} />
            )}
          </div>
        </div>
      )}

      <div className={"list-search" + (!searchOpen && !s.searchInput ? " is-collapsed" : "")}>
        <Search size={14} aria-hidden className="list-search-icon" />
        <input
          id="note-search"
          type="search"
          className="search-field"
          placeholder={notebook ? t("{name}에서 검색", { name: notebook.name }) : t("노트 검색")}
          aria-label={t("노트 검색")}
          value={s.searchInput}
          onChange={(e) => s.setSearchInput(e.target.value)}
        />
      </div>

      {notebook && (
        <NotebookHeader
          notebook={notebook}
          count={s.search || !s.pageData ? null : knownNoteCount(s.pageData.nextCursor, s.page, items.length)}
        />
      )}

      <div className="list-body" role="feed" aria-busy={s.listLoading}>
        {s.listError && (
          <div className="list-state" role="alert">
            <p>{s.listError}</p>
            <button type="button" className="btn" onClick={s.refreshList}>
              {t("다시 시도")}
            </button>
          </div>
        )}

        {!s.listError && s.listLoading && items.length === 0 && (
          <div className="list-state" aria-live="polite">
            <Loader2 size={18} className="spin" aria-hidden />
            <p>{t("불러오는 중…")}</p>
          </div>
        )}

        {!s.listError && !s.listLoading && items.length === 0 && <EmptyList view={s.view} search={s.search} />}

        {items.length > 0 &&
          groups.map((g, i) => (
            <React.Fragment key={g.title + i}>
              {g.title && (
                <GroupHeader
                  title={g.title}
                  sort={notebook && i === 0 ? sort : undefined}
                  onSort={notebook && i === 0 ? changeSort : undefined}
                />
              )}
              {g.items.map((n) => (
                <NoteRow key={n.id} item={n} onMenu={setMenu} />
              ))}
            </React.Fragment>
          ))}
      </div>

      {(hasNext || s.page > 1) && (
        <div className="list-pager">
          <IconButton
            label={t("이전 페이지")}
            disabled={s.page <= 1 || s.listLoading}
            onClick={() => s.goToPage(s.page - 1)}
          >
            <ChevronLeft size={16} aria-hidden />
          </IconButton>
          <span className="pager-info" aria-live="polite">
            {t("{page}페이지 · 표시 {count}개", { page: s.page, count: items.length })}
            {hasNext ? "" : " " + t("(마지막)")}
          </span>
          <IconButton
            label={t("다음 페이지")}
            disabled={!hasNext || s.listLoading}
            onClick={() => s.goToPage(s.page + 1)}
          >
            <ChevronRight size={16} aria-hidden />
          </IconButton>
        </div>
      )}
      {menu && (
        <NoteContextMenu
          {...menu}
          onClose={() => setMenu(null)}
          onReminder={() => setAction({ ...menu, kind: "reminder" })}
          onPublish={() => setAction({ ...menu, kind: "publish" })}
        />
      )}
      {action?.kind === "reminder" && (
        <div
          className="note-action-anchor"
          style={{
            left: Math.max(8, Math.min(action.x, innerWidth - 348)),
            top: Math.max(8, Math.min(action.y, innerHeight - 460)),
          }}
        >
          <ReminderEditor
            id={action.item.id}
            revision={action.item.revision}
            at={action.item.reminder_at}
            repeatHours={action.item.reminder_repeat_hours}
            disabled={false}
            onClose={() => setAction(null)}
          />
        </div>
      )}
      {action?.kind === "publish" && <NoteShareDialog noteID={action.item.id} onClose={() => setAction(null)} />}
    </section>
  );
}

/** 마지막 쪽이면 정확한 노트 수, 아니면 "이상"을 뜻하는 음수. */
function knownNoteCount(nextCursor: unknown, page: number, shown: number): number {
  return nextCursor === null ? (page - 1) * PAGE_SIZE + shown : -page * PAGE_SIZE;
}

function noteCountLabel(count: number | null): string {
  if (count === null) return "";
  return count < 0 ? t("노트 {count}개 이상", { count: -count }) : t("노트 {count}개", { count });
}

/** 노트북 머리말: 상위 노트북 경로, 아이콘, 이름, 설명, 노트 수, 둥근 버튼. */
function NotebookHeader({ notebook, count }: Readonly<{ notebook: Notebook; count: number | null }>) {
  const s = useStore();
  const crumbs: Notebook[] = [];
  for (let parent = notebook.parent_id; parent && crumbs.length < 32;) {
    const found = s.notebooks.find((n) => n.id === parent);
    if (!found) break;
    crumbs.unshift(found);
    parent = found.parent_id;
  }
  return (
    <header className={`notebook-header${notebook.cover ? " has-cover" : ""}`} aria-label={t("노트북 정보")}>
      {notebook.cover && <CoverBanner cover={notebook.cover} />}
      {crumbs.length > 0 && (
        <nav className="notebook-crumbs" aria-label={t("상위 노트북")}>
          {crumbs.map((c) => (
            <React.Fragment key={c.id}>
              <button type="button" onClick={() => s.setView({ type: "notebook", id: c.id })}>
                {c.name}
              </button>
              <ChevronRight size={12} aria-hidden />
            </React.Fragment>
          ))}
          <span>{notebook.name}</span>
        </nav>
      )}
      <NotebookIcon
        size={22}
        aria-hidden
        className="notebook-header-icon"
        style={notebook.color ? { color: notebook.color } : undefined}
      />
      <h2 className="notebook-header-title">{notebook.name}</h2>
      {notebook.description && <p className="notebook-header-desc">{notebook.description}</p>}
      <div className="notebook-header-foot">
        <span className="notebook-header-meta">{noteCountLabel(count)}</span>
        <span className="notebook-header-actions">
          <IconButton label={t("새 노트 만들기 (Ctrl+N)")} onClick={()=>s.newNote()} className="round-btn">
            <Plus size={14} aria-hidden />
          </IconButton>
          <IconButton label={t("노트북 고치기")} onClick={() => void s.renameNotebook(notebook)} className="round-btn">
            <Pencil size={14} aria-hidden />
          </IconButton>
        </span>
      </div>
    </header>
  );
}

function listTitle(view: View, notebooks: { id: string; name: string }[]): string {
  if (view.type === "notebook") {
    return notebooks.find((n) => n.id === view.id)?.name ?? t("노트북");
  }
  return viewTitle(view);
}

function EmptyList({ view, search }: Readonly<{ view: View; search: string }>) {
  if (search) {
    return (
      <div className="list-state">
        <SearchX size={20} aria-hidden />
        <p>{t("검색 결과가 없습니다")}</p>
        <p className="list-state-sub">{t("다른 검색어로 시도해 보세요")}</p>
      </div>
    );
  }
  const messages: Record<string, [string, string]> = {
    all: [t("아직 노트가 없습니다"), t("새 노트 버튼이나 Ctrl+N으로 첫 노트를 만들어 보세요")],
    favorites: [t("즐겨찾기한 노트가 없습니다"), t("노트 메뉴에서 즐겨찾기를 추가할 수 있습니다")],
    archive: [t("보관함이 비어 있습니다"), t("노트 메뉴에서 보관할 수 있습니다")],
    trash: [t("휴지통이 비어 있습니다"), t("삭제된 노트가 여기에 모입니다")],
    notebook: [t("이 노트북에 노트가 없습니다"), t("노트를 만들면 이 노트북에 저장됩니다")],
    tag: [t("이 태그의 노트가 없습니다"), t("노트 편집 화면에서 태그를 추가할 수 있습니다")],
  };
  const [title, sub] = messages[view.type] ?? messages.all;
  return (
    <div className="list-state">
      <StickyNote size={20} aria-hidden />
      <p>{title}</p>
      <p className="list-state-sub">{sub}</p>
    </div>
  );
}

function NoteRow({ item, onMenu }: Readonly<{ item: Summary; onMenu: (target: NoteMenuTarget) => void }>) {
  const s = useStore();
  const selected = s.selectedId === item.id;
  const trashMode = s.view.type === "trash";

  return (
    <article className={`note-row ${selected ? "is-selected" : ""}`} aria-current={selected ? "true" : undefined}>
      <button
        type="button"
        className="note-row-main"
        onClick={(e) => void (e.ctrlKey || e.metaKey ? openInNewTab(s, item.id) : s.selectNote(item.id))}
        onAuxClick={(e) => {
          if (e.button === 1) {
            e.preventDefault();
            void openInNewTab(s, item.id);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onMenu({ item, x: e.clientX, y: e.clientY });
        }}
        onKeyDown={(e) => {
          if (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10")) return;
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          onMenu({ item, x: r.left + 24, y: r.top + r.height / 2 });
        }}
        aria-label={t("노트 열기: {title}", { title: item.title || t("제목 없음") })}
      >
        <div className="note-row-top">
          {item.color && <span className="note-row-color" style={{ background: item.color }} aria-hidden />}
          <h3 className="note-row-title">{item.title || t("제목 없음")}</h3>
          <span className="note-row-flags">
            {item.readonly && <PencilOff size={12} aria-label={t("읽기 전용")} />}
            {item.archived && s.view.type !== "archive" && <Archive size={12} aria-label={t("보관됨")} />}
            {item.pinned && <Pin size={12} aria-label={t("고정됨")} />}
            {item.favorite && <Star size={12} aria-label={t("즐겨찾기")} />}
          </span>
        </div>
        <p className={`note-row-preview${item.preview ? "" : " is-empty"}`}>{item.preview || t("내용 없음")}</p>
        <div className="note-row-meta">
          <span>{formatRelative(item.updated_at)}</span>
          {item.tags.length > 0 && (
            <span className="note-row-tags">
              {item.tags.slice(0, 2).map((t) => (
                <span key={t} className="note-row-tag">
                  {t}
                </span>
              ))}
            </span>
          )}
        </div>
      </button>
      {trashMode && (
        <div className="note-row-actions">
          <IconButton label={t("휴지통에서 복원")} size="sm" onClick={() => void s.quickRestore(item.id)}>
            <RotateCcw size={13} aria-hidden />
          </IconButton>
          <IconButton label={t("영구 삭제")} size="sm" onClick={() => void s.quickDelete(item.id)} className="danger">
            <Trash2 size={13} aria-hidden />
          </IconButton>
        </div>
      )}
    </article>
  );
}
