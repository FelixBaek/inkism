import React, { useCallback, useEffect, useState } from "react";
import { api, rpc } from "../api";
import { useStore } from "../store";
import type { Summary } from "../types";
import { formatDateTime, formatRelative } from "../lib/date";
import { Bell, Loader2 } from "../icons";
import { ReminderEditor } from "./Reminders";
import { nextOccurrence } from "../lib/reminder-schedule";
import { t } from "../i18n";
import "./ShellLists.css";

/** 셸이 노트 목록 자리에 대신 보여 주는 목록: 받은 알림(36), 오늘의 노트(35). */
export type ShellPanel = "reminders" | "daily";

const PAGE = 20;
// due_reminders는 reminder_at <= now 범위를 읽는다. 허용 최댓값을 주면 예약된 알림 전체가 시간순으로 나온다.
const ALL_SCHEDULED = 8_640_000_000_000_000;

export function repeatLabel(hours: number | null | undefined): string {
  if (!hours) return t("한 번");
  if (hours === 24) return t("매일");
  if (hours === 168) return t("매주");
  return t("{n}시간마다", { n: hours });
}

type Page = { items: Summary[]; next: string | null };

function usePagedList(load: (cursor: string | null) => Promise<Page>, refreshEvent?: string) {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const cursor = cursors[cursors.length - 1];
  useEffect(() => {
    let live = true;
    setError("");
    load(cursor)
      .then((value) => live && setPage(value))
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [cursor, version]);
  useEffect(() => {
    if (!refreshEvent) return;
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(refreshEvent, bump);
    window.addEventListener("focus", bump);
    return () => {
      window.removeEventListener(refreshEvent, bump);
      window.removeEventListener("focus", bump);
    };
  }, [refreshEvent]);
  return {
    page,
    error,
    index: cursors.length,
    prev: cursors.length > 1 ? () => setCursors((c) => c.slice(0, -1)) : undefined,
    next: page?.next ? () => setCursors((c) => [...c, page.next]) : undefined,
    reload: () => setVersion((v) => v + 1),
  };
}

function PanelFrame({
  title,
  info,
  list,
  empty,
  children,
}: Readonly<{ title: string; info: string; list: ReturnType<typeof usePagedList>; empty: string; children: React.ReactNode }>) {
  return (
    <section className="note-list shell-list" aria-label={title}>
      <div className="list-header" data-tauri-drag-region="deep">
        <h2 className="list-title">{title}</h2>
      </div>
      <p className="list-info">{info}</p>
      <div className="list-body" role="feed" aria-busy={!list.page}>
        {list.error && (
          <div className="list-state" role="alert">
            <p>{list.error}</p>
            <button type="button" className="btn" onClick={list.reload}>
              {t("다시 시도")}
            </button>
          </div>
        )}
        {!list.error && !list.page && (
          <div className="list-state" aria-live="polite">
            <Loader2 size={18} className="spin" aria-hidden />
            <p>{t("불러오는 중…")}</p>
          </div>
        )}
        {list.page && list.page.items.length === 0 && (
          <div className="list-state">
            <p>{empty}</p>
          </div>
        )}
        {children}
      </div>
      {(list.prev || list.next) && (
        <nav className="list-pager" aria-label={title}>
          <button type="button" className="pager-btn" aria-label={t("이전 페이지")} disabled={!list.prev} onClick={list.prev}>
            {t("이전")}
          </button>
          <span className="pager-info">{list.index}</span>
          <button type="button" className="pager-btn" aria-label={t("다음 페이지")} disabled={!list.next} onClick={list.next}>
            {t("다음")}
          </button>
        </nav>
      )}
    </section>
  );
}

function Row({ item, lines }: Readonly<{ item: Summary; lines: string[] }>) {
  const s = useStore();
  const selected = s.selectedId === item.id;
  return (
    <article className={`note-row ${selected ? "is-selected" : ""}`} aria-current={selected ? "true" : undefined}>
      <button
        type="button"
        className="note-row-main"
        onClick={() => void s.selectNote(item.id)}
        aria-label={t("노트 열기: {title}", { title: item.title || t("제목 없음") })}
      >
        <div className="note-row-top">
          <h3 className="note-row-title">{item.title || t("제목 없음")}</h3>
        </div>
        <p className="note-row-preview">{lines[0]}</p>
        <p className="note-row-meta">{lines[1]}</p>
      </button>
    </article>
  );
}

export function ReminderList() {
  const list = usePagedList(async (cursor) => {
    const after = cursor ? (JSON.parse(cursor) as { at: number; id: string }) : null;
    const items = await rpc<Summary[]>("due_reminders", {
      now: ALL_SCHEDULED,
      limit: PAGE + 1,
      ...(after ? { after_at: after.at, after_id: after.id } : {}),
    });
    const last = items.length > PAGE ? items[PAGE - 1] : null;
    return { items: items.slice(0, PAGE), next: last ? JSON.stringify({ at: last.reminder_at, id: last.id }) : null };
  }, "inkism-reminders-changed");
  const now = Date.now();
  const items = list.page?.items ?? [];
  const due = items.filter((n) => n.reminder_at! <= now).length;
  return (
    <PanelFrame
      title={t("알림")}
      info={t("울린 알림 {due}개 · 예정 {later}개", { due, later: items.length - due })}
      list={list}
      empty={t("예약된 알림이 없습니다")}
    >
      {items.map((n) => (
        <Row
          key={n.id}
          item={n}
          lines={[
            `${formatDateTime(n.reminder_at!)} · ${repeatLabel(n.reminder_repeat_hours)}`,
            n.reminder_at! <= now ? t("{when} 울림", { when: formatRelative(n.reminder_at!, now) }) : t("예정"),
          ]}
        />
      ))}
    </PanelFrame>
  );
}

export function DailyList() {
  const list = usePagedList(async (cursor) => {
    const page = await api.list({
      view: "all",
      daily: true,
      limit: PAGE,
      sort_by: "created_at",
      sort_direction: "desc",
      ...(cursor ? { cursor } : {}),
    });
    return { items: page.items, next: page.next_cursor };
  });
  const items = list.page?.items ?? [];
  return (
    <PanelFrame
      title={t("오늘의 노트")}
      info={t("날짜 순 · {count}개", { count: items.length + (list.page?.next ? "+" : "") })}
      list={list}
      empty={t("일일 노트가 없습니다")}
    >
      {items.map((n) => (
        <Row key={n.id} item={n} lines={[n.preview || t("내용 없음"), [formatRelative(n.updated_at), ...n.tags].join(" · ")]} />
      ))}
    </PanelFrame>
  );
}

/** 열린 노트의 알림이 울렸을 때 편집 영역 위에 띄우는 줄(36). */
export function ReminderBanner() {
  const s = useStore();
  const note = s.note;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const [busy, setBusy] = useState(false);
  const change = useCallback(
    async (at: number | null, repeat?: number | null) => {
      if (!note || busy) return;
      setBusy(true);
      try {
        if (!(await s.setReminder(note.id, at, note.revision, repeat)))
          await s.showError(t("알림"), t("알림을 변경하지 못했습니다. 저장 상태를 확인한 뒤 다시 시도해 주세요."));
      } finally {
        setBusy(false);
      }
    },
    [note?.id, note?.revision, busy],
  );
  if (!note?.reminder_at || note.reminder_at > now) return null;
  const hours = note.reminder_repeat_hours;
  return (
    <output className="reminder-banner">
      <Bell size={16} aria-hidden />
      <span className="reminder-banner-text">
        {[t("알림"), formatDateTime(note.reminder_at), hours ? t("{label} 반복", { label: repeatLabel(hours) }) : repeatLabel(hours)].join("  ·  ")}
      </span>
      <button type="button" className="reminder-banner-ghost" disabled={busy} onClick={() => void change(Date.now() + 10 * 60 * 1000)}>
        {t("10분 뒤 다시 알림")}
      </button>
      <ReminderEditor id={note.id} at={note.reminder_at} revision={note.revision} repeatHours={hours} disabled={busy} />
      <button
        type="button"
        className="reminder-banner-primary"
        disabled={busy}
        onClick={() => {
          const next = nextOccurrence(note.reminder_at!, hours);
          void change(next, next === null ? null : hours);
        }}
      >
        {t("알림 처리")}
      </button>
    </output>
  );
}
