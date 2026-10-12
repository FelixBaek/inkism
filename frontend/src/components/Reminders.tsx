import React, { useEffect, useRef, useState } from "react";
import { Bell } from "../icons";
import { api } from "../api";
import type { Summary } from "../types";
import { useStore } from "../store";
import { t } from "../i18n";
import "./Reminders.css";

function localTime(at: number) {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

type NativeReminderSettings = {
  available: boolean;
  enabled?: boolean;
  background?: boolean;
  background_available?: boolean;
  delivery_error?: string;
};
async function nativeSettings(id = ""): Promise<NativeReminderSettings> {
  const response = await fetch("/api/reminders/settings?id=" + encodeURIComponent(id));
  if (!response.ok) throw new Error(t("시스템 알림 설정을 읽지 못했습니다."));
  return response.json();
}
async function setNativeSettings(settings: object) {
  const response = await fetch("/api/reminders/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.error || t("시스템 알림 설정을 저장하지 못했습니다."));
  }
}
function SystemReminderSettings() {
  const [settings, setSettings] = useState<NativeReminderSettings>({ available: false });
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    nativeSettings()
      .then((value) => {
        if (active) setSettings(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const change = async (value: object) => {
    setBusy(true);
    setError("");
    try {
      await setNativeSettings(value);
      setSettings(await nativeSettings());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      try {
        setSettings(await nativeSettings());
      } catch {
        /* Keep the last confirmed state. */
      }
    } finally {
      setBusy(false);
    }
  };
  if (!settings.available) return null;
  return (
    <fieldset disabled={busy}>
      <legend>{t("이 Windows 기기")}</legend>
      <label>
        <input
          type="checkbox"
          checked={!!settings.enabled}
          onChange={(e) => void change({ enabled: e.target.checked })}
        />
        {t("시스템 알림 켜기")}
      </label>
      <p>{t("알림에는 노트 내용을 표시하지 않습니다.")}</p>
      {settings.background_available && (
        <label>
          <input
            type="checkbox"
            checked={!!settings.background}
            disabled={!settings.enabled}
            onChange={(e) => void change({ background: e.target.checked })}
          />
          {t("앱이 닫히거나 잠겨 있어도 알림 받기")}
        </label>
      )}
      {settings.background_available && (
        <p>
          {t(
            "켜면 이 계정의 Windows 예약 작업이 1분마다 일정 캐시만 확인합니다. 노트·키·저장소는 열지 않습니다. 시간과 반복 간격은 별도 파일에 보관하며, 앱이 닫힌 동안 다른 기기의 변경은 반영되지 않습니다. 절전 후 최신 알림 한 번을 표시합니다.",
          )}
        </p>
      )}
      {settings.delivery_error && <p role="alert">{t("시스템 알림 전송 실패. 연결되면 다시 시도합니다.")}</p>}
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}

/** Without onClose it renders its own trigger button; with onClose it is opened by a menu and only shows the form. */
export function ReminderEditor({
  id,
  at,
  disabled,
  revision,
  repeatHours,
  onClose,
}: Readonly<{
  id: string;
  at: number | null;
  disabled: boolean;
  revision?: number;
  repeatHours?: number | null;
  onClose?: () => void;
}>) {
  const s = useStore();
  const controlled = onClose !== undefined;
  const [open, setOpen] = useState(controlled),
    [value, setValue] = useState(() => (controlled ? localTime(at ?? Date.now() + 3600000) : ""));
  const updateOpen = (next: boolean) => {
    setOpen(next);
    if (!next) onClose?.();
  };
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [repeat, setRepeat] = useState<number>(() => (controlled ? (repeatHours ?? 0) : 0));
  const running = useRef(false);
  const change = async (next: number | null) => {
    if (running.current) return;
    if (next !== null && (!Number.isFinite(next) || next <= Date.now())) {
      setError(t("현재보다 뒤의 시간을 선택해 주세요."));
      return;
    }
    running.current = true;
    setBusy(true);
    setError("");
    try {
      if (await s.setReminder(id, next, revision, next === null || repeat === 0 ? null : repeat)) updateOpen(false);
      else setError(t("알림을 변경하지 못했습니다. 노트의 저장 상태를 확인해 주세요."));
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="reminder-control">
      {!controlled && (
        <button
          className="btn btn-small"
          type="button"
          aria-label={t("노트 알림 설정")}
          aria-expanded={open}
          disabled={disabled}
          onClick={() => {
            updateOpen(!open);
            setError("");
            setValue(localTime(at ?? Date.now() + 3600000));
            setRepeat(s.note?.reminder_repeat_hours ?? 0);
          }}
        >
          <Bell size={15} aria-hidden />
          {at !== null ? t("알림 예약됨") : t("알림")}
        </button>
      )}
      {open && (
        <form
          className="reminder-popover"
          aria-label={t("노트 알림")}
          onKeyDown={(event) => {
            if (controlled && event.key === "Escape") {
              event.stopPropagation();
              updateOpen(false);
            }
          }}
          onSubmit={(event) => {
            event.preventDefault();
            void change(new Date(value).getTime());
          }}
        >
          <label>
            {t("알림 날짜와 시간")}
            <input
              type="datetime-local"
              required
              autoFocus={controlled}
              value={value}
              disabled={busy}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
          <p>{t("이 기기의 현지 시간입니다. 앱 실행 중 표시하며, 지난 알림은 다음 실행 때 보여줍니다.")}</p>
          <label>
            {t("반복")}
            <select
              aria-label={t("알림 반복")}
              value={repeat}
              disabled={busy}
              onChange={(e) => setRepeat(Number(e.target.value))}
            >
              <option value={0}>{t("반복 없음")}</option>
              <option value={24}>{t("24시간마다")}</option>
              <option value={168}>{t("7일마다")}</option>
            </select>
          </label>
          <p>
            {t(
              "예약 시각부터 UTC 기준 일정한 간격입니다. 시간대나 서머타임이 바뀌면 현지 표시 시간이 달라질 수 있습니다. 절전 후에는 최신 알림 한 번만 표시합니다.",
            )}
          </p>
          <SystemReminderSettings />
          {at !== null && <p>{t("예약: {time}", { time: new Date(at).toLocaleString() })}</p>}
          {error && <p role="alert">{error}</p>}
          <div className="reminder-actions">
            <button className="btn btn-primary btn-small" disabled={busy} type="submit">
              {t("알림 저장")}
            </button>
            {at !== null && (
              <button className="btn btn-small" disabled={busy} type="button" onClick={() => void change(null)}>
                {t("알림 해제")}
              </button>
            )}
            <button className="btn btn-small" disabled={busy} type="button" onClick={() => updateOpen(false)}>
              {t("닫기")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export function DueReminders() {
  const s = useStore();
  const [items, setItems] = useState<Summary[]>([]),
    [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [changing, setChanging] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const changingRef = useRef(false);
  const change = async (note: Summary, at: number | null) => {
    if (changingRef.current) return;
    changingRef.current = true;
    setChanging(note.id);
    setActionError("");
    try {
      if (await s.setReminder(note.id, at, note.revision)) {
        setItems((current) => current.filter((item) => item.id !== note.id));
      } else {
        setActionError(t("알림을 변경하지 못했습니다. 저장 상태를 확인한 뒤 다시 시도해 주세요."));
      }
    } catch {
      setActionError(t("알림을 변경하지 못했습니다. 다시 시도해 주세요."));
    } finally {
      changingRef.current = false;
      setChanging(null);
      window.dispatchEvent(new Event("inkism-reminders-changed"));
    }
  };
  useEffect(() => {
    let disposed = false,
      running = false;
    const poll = async () => {
      if (running) return;
      running = true;
      try {
        const result = await api.dueReminders();
        if (!disposed) {
          setItems(result);
          setError("");
        }
      } catch {
        if (!disposed) setError(t("알림을 확인하지 못했습니다. 연결되면 다시 확인합니다."));
      } finally {
        running = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 15000);
    window.addEventListener("inkism-reminders-changed", poll);
    window.addEventListener("focus", poll);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener("inkism-reminders-changed", poll);
      window.removeEventListener("focus", poll);
    };
  }, [s.note?.id, s.note?.revision]);
  if (!items.length && !error && !actionError) return null;
  return (
    <aside className="reminder-inbox" aria-label={t("도래한 노트 알림")}>
      {error && <output>{error}</output>}
      {actionError && <p role="alert">{actionError}</p>}
      {!!items.length && (
        <>
          <button
            className="btn btn-small"
            aria-label={t("도래한 알림 {n}개", { n: items.length + (items.length === 50 ? "+" : "") })}
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            <Bell size={15} aria-hidden />
            <output>{t("도래한 알림 {n}개", { n: items.length + (items.length === 50 ? "+" : "") })}</output>
          </button>
          {expanded && (
            <ul>
              {items.map((note) => (
                <li key={note.id}>
                  <button type="button" className="btn btn-small" onClick={() => void s.selectNote(note.id)}>
                    {note.title || t("제목 없음")}
                  </button>
                  <time dateTime={new Date(note.reminder_at!).toISOString()}>
                    {new Date(note.reminder_at!).toLocaleString()}
                  </time>
                  <fieldset
                    className="reminder-actions plain-fieldset"
                    aria-label={t("{title} 알림 처리", { title: note.title || t("제목 없음") })}
                  >
                    <button
                      type="button"
                      className="btn btn-small"
                      disabled={changing !== null}
                      onClick={() => void change(note, Date.now() + 10 * 60 * 1000)}
                    >
                      {t("10분 뒤 다시 알림")}
                    </button>
                    <button
                      type="button"
                      className="btn btn-small"
                      disabled={changing !== null}
                      onClick={() => void change(note, null)}
                    >
                      {t("알림 해제")}
                    </button>
                  </fieldset>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </aside>
  );
}
