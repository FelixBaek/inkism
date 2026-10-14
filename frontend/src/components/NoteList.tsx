import React, { useState, useEffect } from "react";
import {
  Plus,
  Pin,
  Trash2,
  RotateCcw,
  Star,
  ChevronRight,
  Loader2,
  SearchX,
  StickyNote,
  PencilOff,
  Archive,
} from "../icons";
import { useStore, viewTitle, PAGE_SIZE } from "../store";
import { formatRelative } from "../lib/date";
import type { TrashDays } from "../api";
import type { Notebook, Summary, View } from "../types";
import { IconButton } from "./IconButton";
import { NoteContextMenu, type NoteMenuTarget } from "./NoteContextMenu";
import { ReminderEditor } from "./Reminders";
import { NoteShareDialog } from "./NoteShareDialog";
import { CoverBanner } from "./NotebookCover";
import { GroupHeader, sortLabel, useListSort } from "./NoteListSort";
import { groupItems } from "../lib/list-sort";
import { openInNewTab } from "./NoteTabs";
import {
  ArchiveTabs,
  TrashRetention,
  TrashSelectionDialog,
  trashLabel,
  useTrashPurge,
  useTrashTimes,
} from "./TrashTools";
import "./NoteList.css";
import { t } from "../i18n";
import { NotebookGlyph, tagColor } from "./LibraryStyle";

function trashRowLabel(at: number | undefined, archived: boolean, retention: TrashDays) {
  return trashLabel(at, archived ? null : retention);
}

function pageCount(total: number | undefined, hasNext: boolean, page: number) {
  if (total !== undefined) return Math.max(1, Math.ceil(total / PAGE_SIZE));
  return hasNext ? null : page;
}
function listInfo(search: string, hasNext: boolean, page: number, length: number, order: string, count: number | null) {
  if (search)
    return t(hasNext ? "{count}개 이상 검색 결과" : "{count}개 검색 결과", { count: (page - 1) * PAGE_SIZE + length });
  if (count === null) return order;
  const amount = count < 0 ? t("{count}개 이상", { count: -count }) : t("{count}개", { count });
  return order + " · " + amount;
}
function ListStatus({
  error,
  loading,
  empty,
  view,
  search,
  retry,
}: Readonly<{
  error: string | null;
  loading: boolean;
  empty: boolean;
  view: View;
  search: string;
  retry: () => void;
}>) {
  if (error)
    return (
      <div className="list-state" role="alert">
        <p>{error}</p>
        <button type="button" className="btn" onClick={retry}>
          {t("다시 시도")}
        </button>
      </div>
    );
  if (!empty) return null;
  if (loading)
    return (
      <div className="list-state" aria-live="polite">
        <Loader2 size={18} className="spin" aria-hidden />
        <p>{t("불러오는 중…")}</p>
      </div>
    );
  return <EmptyList view={view} search={search} />;
}

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
  const title = s.search ? t("검색 결과") : listTitle(s.view, s.notebooks);
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
  // 전체 노트는 총 개수를 알고, 다른 보기는 마지막 쪽에 닿아야 정확한 수를 안다(음수 = "이상").
  const total = s.view.type === "all" && !s.search ? s.stats?.notes : undefined;
  const count = !s.pageData ? null : (total ?? knownNoteCount(s.pageData.nextCursor, s.page, items.length));
  const pages = pageCount(total, hasNext, s.page);
  const trash = s.view.type === "trash";
  const shelf = trash || s.view.type === "archive";
  useTrashPurge();
  const [times, retention, setRetention] = useTrashTimes(items, trash);
  // 지운 노트에서 Ctrl/Shift+클릭으로 고른 노트들. 보기가 바뀌면 비운다.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [cleanup, setCleanup] = useState(false);
  const viewKey = JSON.stringify(s.view);
  useEffect(() => setPicked(new Set()), [viewKey]);
  const pick = (id: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  // 지운 노트는 편집할 수 없어 수정 시각이 곧 지운 시각이다.
  const order = trash && sort.sortBy === "updated_at" && sort.sortDirection === "desc" ? t("지운 순") : sortLabel(sort);

  return (
    <section className="note-list" aria-label={t("노트 목록")}>
      <div className="list-header" data-tauri-drag-region="deep">
        <h2 className="list-title">{title}</h2>
        <div className="list-header-actions" data-tauri-drag-region="false">
          <IconButton label={t("새 노트 만들기 (Ctrl+N)")} onClick={() => s.newNote()}>
            <Plus size={16} aria-hidden />
          </IconButton>
          <GroupHeader
            title=""
            sort={sort}
            onSort={changeSort}
            extra={[
              ...(notebook ? [{ label: t("폴더 고치기"), onSelect: () => void s.renameNotebook(notebook) }] : []),
              ...(trash
                ? [
                    { label: t("지운 노트 정리…"), onSelect: () => setCleanup(true) },
                    { label: t("지운 노트 모두 비우기"), danger: true, onSelect: () => void s.emptyTrash() },
                  ]
                : []),
            ]}
          />
        </div>
      </div>
      <div className={"list-search" + (!searchOpen && !s.searchInput ? " is-collapsed" : "")}>
        <label className="list-search-label" htmlFor="note-search">
          {t("노트 검색")}
        </label>
        <input
          id="note-search"
          type="search"
          className="search-field"
          placeholder={notebook ? t("{name}에서 검색", { name: notebook.name }) : ""}
          aria-label={t("노트 검색")}
          value={s.searchInput}
          onChange={(e) => s.setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            s.setSearchInput("");
            setSearchOpen(false);
          }}
          onBlur={() => !s.searchInput && setSearchOpen(false)}
        />
      </div>
      {shelf && (
        <div className="list-shelf">
          <ArchiveTabs />
          {trash && <TrashRetention days={retention} onChange={setRetention} />}
        </div>
      )}
      <p className="list-info">
        {listInfo(s.search, hasNext, s.page, items.length, order, count)}
        {trash && picked.size > 0 && (
          <>
            {" · "}
            <button type="button" className="list-info-action" onClick={() => setCleanup(true)}>
              {t("{count}개 선택됨", { count: picked.size })}
            </button>
          </>
        )}
      </p>

      {notebook && <NotebookHeader notebook={notebook} />}

      <div className="list-body" role="feed" aria-busy={s.listLoading}>
        <ListStatus
          error={s.listError}
          loading={s.listLoading}
          empty={items.length === 0}
          view={s.view}
          search={s.search}
          retry={s.refreshList}
        />

        {items.length > 0 &&
          groups.map((g, i) => (
            <React.Fragment key={g.title + i}>
              {g.title && <GroupHeader title={g.title} />}
              {g.items.map((n) => (
                <NoteRow
                  key={n.id}
                  item={n}
                  onMenu={setMenu}
                  picked={picked.has(n.id)}
                  onPick={trash ? () => pick(n.id) : undefined}
                  meta={trash ? trashRowLabel(times[n.id], n.archived, retention) : undefined}
                />
              ))}
            </React.Fragment>
          ))}
      </div>

      {(s.page > 1 || hasNext) && (
        <nav className="list-pager" aria-label={t("노트 목록")}>
          <button
            type="button"
            className="pager-btn"
            aria-label={t("이전 페이지")}
            disabled={s.page <= 1 || s.listLoading}
            onClick={() => s.goToPage(s.page - 1)}
          >
            {t("이전")}
          </button>
          <span className="pager-info" aria-live="polite">
            {s.page} / {pages ?? "…"}
          </span>
          <button
            type="button"
            className="pager-btn"
            aria-label={t("다음 페이지")}
            disabled={!hasNext || s.listLoading}
            onClick={() => s.goToPage(s.page + 1)}
          >
            {t("다음")}
          </button>
        </nav>
      )}
      {cleanup && (
        <TrashSelectionDialog
          ids={[...picked]}
          onClose={(done) => {
            setCleanup(false);
            if (done) setPicked(new Set());
          }}
        />
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

/** 폴더 머리말: 표지, 상위 폴더 경로, 설명. 이름·개수·버튼은 목록 머리에 있다. */
function NotebookHeader({ notebook }: Readonly<{ notebook: Notebook }>) {
  const s = useStore();
  const crumbs: Notebook[] = [];
  for (let parent = notebook.parent_id; parent && crumbs.length < 32;) {
    const found = s.notebooks.find((n) => n.id === parent);
    if (!found) break;
    crumbs.unshift(found);
    parent = found.parent_id;
  }
  if (!notebook.cover && crumbs.length === 0 && !notebook.description) return null;
  return (
    <header className={`notebook-header${notebook.cover ? " has-cover" : ""}`} aria-label={t("폴더 정보")}>
      {notebook.cover && <CoverBanner cover={notebook.cover} />}
      {crumbs.length > 0 && (
        <nav className="notebook-crumbs" aria-label={t("상위 폴더")}>
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
      {notebook.description && <p className="notebook-header-desc">{notebook.description}</p>}
    </header>
  );
}

function listTitle(view: View, notebooks: { id: string; name: string }[]): string {
  if (view.type === "notebook") {
    const name = notebooks.find((n) => n.id === view.id)?.name;
    return name ? `${t("폴더")} · ${name}` : t("폴더");
  }
  if (view.type === "tag") return `${t("태그")} · ${view.name}`;
  // 보관한 노트와 지운 노트는 한 "보관함" 화면의 두 탭이다.
  if (view.type === "trash") return t("보관함");
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
    trash: [t("지운 노트가 없습니다"), t("삭제된 노트가 여기에 모입니다")],
    notebook: [t("이 폴더에 노트가 없습니다"), t("노트를 만들면 이 폴더에 저장됩니다")],
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

const RECOVERY_SUFFIX = /\s*\((분할 )?자동 복구\)$/;

function NoteRow({
  item,
  onMenu,
  picked = false,
  onPick,
  meta,
}: Readonly<{
  item: Summary;
  onMenu: (target: NoteMenuTarget) => void;
  picked?: boolean;
  /** 있으면 Ctrl/Shift+클릭이 새 탭 대신 여러 노트 고르기다(지운 노트). */
  onPick?: () => void;
  /** 날짜·폴더 대신 보일 줄(지운 노트: 지운 시각·삭제 예정). */
  meta?: string;
}>) {
  const s = useStore();
  const selected = s.selectedId === item.id;
  const trashMode = s.view.type === "trash";
  // 날짜 옆 자리: 태그 보기면 그 태그, 아니면 폴더 이름, 폴더가 없으면 첫 태그.
  const notebook = s.notebooks.find((n) => n.id === item.notebook_id);
  const notebookName = notebook?.name;
  const tag = s.view.type === "tag" ? s.view.name : item.tags[0];
  const tagLabel = tag ? `# ${tag}` : "";
  const place = s.view.type !== "tag" && notebookName ? notebookName : tagLabel;
  // 자동 복구 사본은 제목 끝 접미사를 배지로 떼어, 긴 제목이 잘려도 사본임이 보이게 한다.
  const suffix = RECOVERY_SUFFIX.exec(item.title);
  const shownTitle = suffix ? item.title.slice(0, suffix.index) : item.title;
  const recovery = suffix && (suffix[1] ? t("분할 자동 복구") : t("자동 복구"));

  return (
    <article
      className={`note-row ${selected ? "is-selected" : ""} ${picked ? "is-picked" : ""}`}
      aria-current={selected ? "true" : undefined}
    >
      <button
        type="button"
        className="note-row-main"
        aria-pressed={onPick ? picked : undefined}
        onClick={(e) => {
          const multi = e.ctrlKey || e.metaKey || e.shiftKey;
          if (onPick && multi) onPick();
          else void (e.ctrlKey || e.metaKey ? openInNewTab(s, item.id) : s.selectNote(item.id));
        }}
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
          // Delete: 지운 노트로 옮기기(지운 노트는 영구 삭제, 기존 확인 창을 따른다). 컨텍스트 메뉴의 "Del"과 같다.
          if (e.key === "Delete" && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
            e.preventDefault();
            if (item.trashed) void s.quickDelete(item.id);
            else void s.patchNoteById(item.id, { trashed: true }, item.revision);
            return;
          }
          if (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10")) return;
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          onMenu({ item, x: r.left + 24, y: r.top + r.height / 2 });
        }}
        aria-label={t("노트 열기: {title}", { title: item.title || t("제목 없음") })}
      >
        <div className="note-row-top">
          {item.color && <span className="note-row-color" style={{ background: item.color }} aria-hidden />}
          <h3 className={`note-row-title${shownTitle ? "" : " is-untitled"}`}>{shownTitle || t("제목 없음")}</h3>
          <span className="note-row-flags">
            {recovery && <span className="note-row-badge">{recovery}</span>}
            {item.readonly && <PencilOff size={12} aria-label={t("읽기 전용")} />}
            {item.archived && s.view.type !== "archive" && <Archive size={12} aria-label={t("보관됨")} />}
            {item.pinned && <Pin size={12} aria-label={t("고정됨")} />}
            {item.favorite && <Star size={12} aria-label={t("즐겨찾기")} />}
          </span>
        </div>
        <p className={`note-row-preview${item.preview ? "" : " is-empty"}`}>{item.preview || t("내용 없음")}</p>
        <p className="note-row-meta">
          {meta || (
            <>
              {formatRelative(item.updated_at)}
              {place && " · "}
              {place && place === tagLabel ? (
                <>
                  <span style={{ color: tagColor(s.tags, tag!) }}>#</span> {tag}
                </>
              ) : (
                place && (
                  <span className="note-row-place">
                    <NotebookGlyph nb={notebook} size={12} />
                    {place}
                  </span>
                )
              )}
            </>
          )}
        </p>
      </button>
      {trashMode && (
        <div className="note-row-actions">
          <IconButton label={t("복원")} size="sm" onClick={() => void s.quickRestore(item.id)}>
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
