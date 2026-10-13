/** 보관함 화면(Figma 07·08): 보관한 노트/지운 노트 탭, 지운 노트 자동 삭제 기간, 지운 시각 표시, 여러 노트 정리 창. */
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, type TrashDays } from "../api";
import { useStore } from "../store";
import { t } from "../i18n";
import { X } from "../icons";
import { forgetRichHistory } from "../lib/rich-history-cache";
import { forgetSourceHistory } from "../lib/source-history-cache";
import { forgetWindowHistory } from "../lib/window-history-cache";
import type { Summary } from "../types";

const DAY = 86_400_000;
const PURGE_EVERY = 60 * 60_000;

/** 보관한 노트 | 지운 노트. 두 보기를 한 "보관함" 화면의 탭으로 묶는다. */
export function ArchiveTabs() {
  const s = useStore();
  return (
    <div className="list-segmented" role="tablist" aria-label={t("보관함")}>
      {(["archive", "trash"] as const).map((type) => (
        <button
          key={type}
          type="button"
          role="tab"
          aria-selected={s.view.type === type}
          onClick={() => s.setView({ type })}
        >
          {type === "archive" ? t("보관한 노트") : t("지운 노트")}
        </button>
      ))}
    </div>
  );
}

/** 자동 삭제 기간. 기본은 "안 함"이고, 기간을 켤 때만 확인을 받는다. */
export function TrashRetention({ days, onChange }: Readonly<{ days: TrashDays; onChange: (days: TrashDays) => void }>) {
  const s = useStore();
  const choose = async (next: TrashDays) => {
    if (next === days) return;
    if (next !== null) {
      const ok = await s.confirm({
        title: t("지운 노트 자동 삭제"),
        message: t("지운 지 {days}일이 지난 노트를 자동으로 영구 삭제합니다. 보관한 노트는 지우지 않습니다. 영구 삭제한 노트는 복원할 수 없습니다.", { days: next }),
        confirmLabel: t("자동 삭제 켜기"),
        danger: true,
      });
      if (!ok) return;
    }
    try {
      onChange((await api.setTrashRetention(next)).days);
      if (next !== null) await purgeExpired(s);
    } catch (e) {
      await s.showError(t("자동 삭제"), e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="trash-retention">
      <span>{t("자동 삭제")}</span>
      <div className="list-segmented" role="radiogroup" aria-label={t("자동 삭제")}>
        {([7, 30, 90, null] as const).map((d) => (
          <button key={String(d)} type="button" role="radio" aria-checked={days === d} onClick={() => void choose(d)}>
            {d === null ? t("안 함") : t("{days}일", { days: d })}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 지운 노트 페이지의 지운 시각과 자동 삭제 기간. */
export function useTrashTimes(items: Summary[], active: boolean): [Record<string, number>, TrashDays, (d: TrashDays) => void] {
  const [times, setTimes] = useState<Record<string, number>>({});
  const [days, setDays] = useState<TrashDays>(null);
  const key = active ? items.map((n) => n.id).join() : "";
  useEffect(() => {
    if (!active) return;
    let live = true;
    api
      .trashTimes(items.map((n) => n.id))
      .then((r) => live && (setTimes(r.times), setDays(r.days)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // key는 items의 id 목록이다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return [times, days, setDays];
}

/** "오늘 지움 · 30일 뒤 삭제" */
export function trashLabel(at: number | undefined, days: TrashDays, now = Date.now()): string {
  if (at === undefined) return "";
  const ago = Math.max(0, Math.floor((now - at) / DAY));
  const when = ago === 0 ? t("오늘 지움") : ago === 1 ? t("어제 지움") : t("{n}일 전 지움", { n: ago });
  if (days === null) return when;
  const left = days - ago;
  return `${when} · ${left > 0 ? t("{n}일 뒤 삭제", { n: left }) : t("곧 삭제")}`;
}

type Store = ReturnType<typeof useStore>;

/** 기간이 지난 지운 노트를 엔진에서 지우고, 이 기기의 편집 기록 캐시도 함께 지운다. */
async function purgeExpired(s: Store) {
  let deleted = 0;
  for (let more = true, rounds = 0; more && rounds < 50; rounds++) {
    const r = await api.trashPurge();
    for (const id of r.deleted) {
      forgetWindowHistory(id);
      forgetSourceHistory(id);
      forgetRichHistory(id);
      window.dispatchEvent(new CustomEvent("inkism-note-deleted", { detail: id }));
    }
    deleted += r.deleted.length;
    more = r.more;
  }
  if (deleted) {
    s.refreshList();
    void s.refreshMeta();
  }
}

/** 앱이 켜져 있는 동안 시작할 때와 한 시간마다 기간이 지난 지운 노트를 정리한다. */
export function useTrashPurge() {
  const s = useStore();
  const ref = useRef(s);
  ref.current = s;
  useEffect(() => {
    const run = () => void purgeExpired(ref.current).catch(() => undefined);
    run();
    const timer = window.setInterval(run, PURGE_EVERY);
    return () => window.clearInterval(timer);
  }, []);
}

/** 지운 노트 N개 선택됨: 복원·영구 삭제·모두 비우기 (Figma 08 팝업). */
export function TrashSelectionDialog({
  ids,
  onClose,
}: Readonly<{ ids: string[]; onClose: (done: boolean) => void }>) {
  const s = useStore();
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
    return () => {
      if (el?.open) el.close();
    };
  }, []);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
      onClose(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <dialog ref={ref} className="dialog-layer" onCancel={(e) => (e.preventDefault(), onClose(false))}>
      <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose(false)}>
        <div className="dialog trash-dialog" role="dialog" aria-modal="true" aria-labelledby="trash-dialog-title">
          <div className="dialog-title-row">
            <h2 id="trash-dialog-title" className="dialog-title">
              {ids.length ? t("지운 노트 {count}개 선택됨", { count: ids.length }) : t("지운 노트")}
            </h2>
            <button type="button" className="icon-btn" aria-label={t("대화상자 닫기")} onClick={() => onClose(false)}>
              <X size={16} aria-hidden />
            </button>
          </div>
          <p className="dialog-message">{t("선택한 노트를 복원하거나 영구 삭제할 수 있어요.")}</p>
          <p className="dialog-note">{t("영구 삭제한 노트는 복원할 수 없습니다.")}</p>
          <div className="dialog-actions">
            <button
              type="button"
              className="btn btn-ghost danger-text"
              disabled={busy}
              onClick={() => {
                onClose(false);
                void s.emptyTrash();
              }}
            >
              {t("지운 노트 모두 비우기")}
            </button>
            <span className="dialog-actions-gap" />
            <button
              type="button"
              className="btn"
              disabled={busy || !ids.length}
              onClick={() => void run(async () => { for (const id of ids) await s.quickDelete(id, true); })}
            >
              {t("영구 삭제")}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !ids.length}
              onClick={() => void run(async () => { for (const id of ids) await s.quickRestore(id); })}
            >
              {t("복원")}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
