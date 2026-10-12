import {useDialogVisibility} from '../lib/dialog-visibility';
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { Scissors } from "../icons";
import { useStore } from "../store";
import "./SharingDialogs.css";
import { t } from "../i18n";
type Clip = { id: string; title: string; html: string; url: string };
async function command<T>(body?: unknown): Promise<T> {
  const r = await fetch(
    "/api/clipper",
    body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {},
  );
  const v = await r.json();
  if (!r.ok || !v.ok) throw Object.assign(new Error(v.error || t("클리퍼 요청에 실패했습니다.")), {status:r.status});
  return v.data as T;
}
export function WebClipperDialog() {
  const store = useStore(),
    dialog = useRef<HTMLDialogElement>(null),
    active = useRef(false),
    generation = useRef(0);
  const [open, setOpen] = useState(false),
    [extension, setExtension] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [access, setAccess] = useState<{ url: string; token: string } | null>(null),
    [pending, setPending] = useState<Clip | null>(null);
  useDialogVisibility(dialog,open);
  useEffect(() => {
    if (!open) return;
    let live = true;
    const poll = () => {
      const version = generation.current;
      void command<Clip | null>()
        .then((v) => {
          if (live && version === generation.current) setPending(v);
        })
        .catch((e) => {
          if (live && version === generation.current) setError(e.message);
        });
    };
    poll();
    const id = setInterval(poll, 1500);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [open]);
  const run = async (fn: () => Promise<void>) => {
    if (active.current) return;
    active.current = true;
    generation.current++;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      active.current = false;
      setBusy(false);
    }
  };
  const close = () =>
    void run(async () => {
      try { await command({ action: "stop" }); }
      catch(error) {
        // Hosts without a clipper must still let an unpaired dialog close.
        if(access || !(error instanceof Error) || error.message !== "clipper unavailable" || (error as Error & {status?:number}).status !== 503) throw error;
      }
      setAccess(null);
      setPending(null);
      setOpen(false);
    });
  return (
    <>
      <button className="side-item" type="button" onClick={() => setOpen(true)}>
        <span className="side-icon">
          <Scissors size={15} />
        </span>
        <span className="side-label">{t("웹 클리퍼")}</span>
      </button>
      {createPortal(<dialog
        ref={dialog}
        className="sharing-dialog dialog"
        aria-labelledby="clipper-title"
        onCancel={(e) => {
          e.preventDefault();
          if (!busy) close();
        }}
      >
        <h2 id="clipper-title">{t("웹 클리퍼")}</h2>
        <p>
          {t(
            "확장에서 선택한 영역 또는 페이지를 받아 미리 본 뒤 저장합니다. 이미지·첨부·스크립트는 가져오지 않습니다. 연결을 종료하면 아직 저장하지 않은 클리핑은 버립니다.",
          )}
        </p>
        <label>
          {t("확장 프로그램 ID")}
          <input
            aria-label={t("클리퍼 확장 ID")}
            value={extension}
            onChange={(e) => setExtension(e.target.value)}
            placeholder={t("Chrome/Edge 확장 관리 화면의 32자 ID")}
          />
        </label>
        <button
          className="btn"
          disabled={busy || !!pending}
          onClick={() => void run(async () => setAccess(await command({ action: "pair", extension })))}
        >
          {t("15분 연결 시작")}
        </button>
        {access && (
          <fieldset>
            <legend>{t("확장 팝업에 입력 (앱 종료·연결 종료 시 폐기)")}</legend>
            <label>
              {t("수신 주소")}
              <input readOnly aria-label={t("클리퍼 수신 주소")} value={access.url} />
            </label>
            <label>
              {t("일회 연결 토큰")}
              <input readOnly type="password" aria-label={t("클리퍼 연결 토큰")} value={access.token} />
            </label>
            <button className="btn" onClick={() => void run(async () => navigator.clipboard.writeText(access.token))}>
              {t("토큰 복사")}
            </button>
          </fieldset>
        )}
        {pending && (
          <section>
            <h3>{pending.title}</h3>
            <p className="sharing-source">{pending.url}</p>
            <div className="sharing-preview" dangerouslySetInnerHTML={{ __html: pending.html }} />
            <div className="dialog-actions">
              <button
                className="btn"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await command({ action: "discard", id: pending.id });
                    setPending(null);
                  })
                }
              >
                {t("클리핑 버리기")}
              </button>
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (!(await store.flushNow())) throw new Error(t("현재 노트를 저장한 뒤 다시 시도해 주세요."));
                    const note = await command<{ id: string }>({ action: "accept", id: pending.id });
                    setPending(null);
                    store.refreshList();
                    await store.refreshMeta();
                    await store.selectNote(note.id);
                  })
                }
              >
                {t("새 노트로 저장")}
              </button>
            </div>
          </section>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button className="btn" disabled={busy} onClick={close}>
            {t("연결 종료·닫기")}
          </button>
        </div>
      </dialog>, document.body)}
    </>
  );
}
