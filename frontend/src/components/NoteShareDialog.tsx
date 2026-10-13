import { useEffect, useRef, useState } from "react";
import { rpc } from "../api";
import { useStore } from "../store";
import "./SharingDialogs.css";
import { t } from "../i18n";
import { SharingWorkspace } from "./SharingWorkspace";
import { X } from "../icons";
type Publication = { id: string; title: string; created: number; expires: number; invite_only?: boolean };
/** With onClose the dialog opens immediately (menu entry) and reports when it closes. */
export function NoteShareDialog({ noteID, onClose }: Readonly<{ noteID: string; onClose?: () => void }>) {
  const store = useStore(),
    dialog = useRef<HTMLDialogElement>(null),
    active = useRef(false);
  const [target, setTarget] = useState(noteID);
  const [token, setToken] = useState(""),
    [days, setDays] = useState(7),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [ack, setAck] = useState(false);
  const [items, setItems] = useState<Publication[]>([]),
    [origin, setOrigin] = useState(""),
    [link, setLink] = useState("");
  const [password,setPassword]=useState("");
  const [useSync, setUseSync] = useState(true);
  const [manageShares, setManageShares] = useState(false);
  useEffect(() => {
    if (onClose) dialog.current?.showModal();
    return () => {
      dialog.current?.close();
    };
  }, []);
  const request = async (action: string, extra: object = {}) => {
    const r = await fetch("/api/publications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, token: useSync ? "" : token, use_sync_token: useSync, ...extra }),
    });
    const v = await r.json();
    if (!r.ok || !v.ok) throw new Error(v.error || t("공유 요청에 실패했습니다."));
    if (v.public_origin) setOrigin(v.public_origin);
    return v;
  };
  const run = async (fn: () => Promise<void>) => {
    if (active.current) return;
    active.current = true;
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
  const revoke = (id: string) =>
    run(async () => {
      await request("revoke", { id });
      setItems((v) => v.filter((x) => x.id !== id));
      if (link.endsWith(id)) setLink("");
    });
  const close = () => {
    if (busy) return;
    setToken("");setPassword("");
    setAck(false);
    dialog.current?.close();
  };
  return (
    <>
      {!onClose && (
        <button
          className="btn"
          type="button"
          onClick={() => {
            setTarget(noteID);
            setError("");
            setLink("");
            setItems([]);
            setAck(false);
            dialog.current?.showModal();
          }}
        >
          {t("공개 링크")}
        </button>
      )}
      <dialog
        ref={dialog}
        className="sharing-dialog dialog"
        aria-labelledby="share-title"
        onClose={(event) => {
          if (!event.currentTarget.open) onClose?.();
        }}
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
      >
        <div className="dialog-title-row">
          <h2 id="share-title" className="dialog-title">{t("공개 링크")}</h2>
          <button type="button" className="icon-btn" aria-label={t("대화상자 닫기")} disabled={busy} onClick={close}>
            <X size={16} aria-hidden />
          </button>
        </div>
        <label>
          {t("공개 기간")}
          <select aria-label={t("공개 기간")} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[1, 3, 7, 14, 30].map((n) => (
              <option key={n} value={n}>
                {t("{n}일", { n })}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("공개 서버 토큰")}
          <select value={useSync ? "sync" : "manual"} onChange={(e) => setUseSync(e.target.value === "sync")}>
            <option value="sync">{t("동기화 토큰 사용")}</option>
            <option value="manual">{t("직접 입력")}</option>
          </select>
        </label>
        {!useSync && (
          <label>
            {t("현재 동기화 서버 토큰")}
            <input
              type="password"
              autoComplete="off"
              aria-label={t("공개 서버 토큰")}
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <small>{t("이 창에서만 사용하며 별도로 저장하지 않습니다.")}</small>
          </label>
        )}
        <label>{t("공개 비밀번호")}<input type="password" maxLength={512} autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>
        <p className="dialog-note">
          {t(
            "기존 동기화 서버에 저장된 본문의 별도 사본을 공개합니다. 링크를 아는 사람은 로그인 없이 읽습니다. 서버 운영자도 공개 사본을 읽을 수 있습니다. 노트 수정·삭제는 공개 사본을 바꾸지 않습니다.",
          )}
        </p>
        <label className="sharing-check">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          {t("현재 노트 본문이 공개됨을 확인했습니다.")}
        </label>
        {link && (
          <label>
            {t("새 공개 링크")}
            <span className="sharing-field-row">
              <input aria-label={t("새 공개 링크")} value={link} readOnly />
              <button className="btn" onClick={() => void run(async () => navigator.clipboard.writeText(link))}>
                {t("링크 복사")}
              </button>
            </span>
          </label>
        )}
        <p className="dialog-note">
          {t(
            "이미지·첨부·링크 주소·수식·일부 서식은 제외됩니다. 비밀번호는 선택 사항입니다. 인터넷 공유에는 승인된 HTTPS 서버가 필요합니다.",
          )}
        </p>
        {items.length > 0 && (
          <ul className="sharing-list">
            {items.map((item) => (
              <li key={item.id}>
                <span>
                  <strong>{item.title}</strong> · {t("{date} 만료", { date: new Date(item.expires * 1000).toLocaleDateString() })}
                </span>
                <button
                  className="btn btn-small"
                  disabled={busy || item.invite_only}
                  onClick={() => void run(async () => navigator.clipboard.writeText(origin + "/p/" + item.id))}
                >
                  {t("복사")}
                </button>
                <button className="btn btn-small btn-ghost danger-text" disabled={busy} onClick={() => void revoke(item.id)}>
                  {t("공개 취소")}
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => void run(async () => setItems((await request("list")).data))}
          >
            {t("공개 중인 사본 확인")}
          </button>
          <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => setManageShares(v => !v)}>{manageShares ? t("공개 링크") : t("초대와 권한 관리")}</button>
          <span className="dialog-actions-gap" />
          <button
            className="btn btn-primary"
            disabled={busy || !ack}
            onClick={() =>
              void run(async () => {
                if (noteID !== target) throw new Error(t("선택된 노트가 바뀌었습니다. 창을 닫고 다시 확인해 주세요."));
                if (!(await store.flushNow())) throw new Error(t("노트를 저장하지 못해 공개하지 않았습니다."));
                const saved = await rpc<{ revision: number }>("get", { id: target });
                const result = await request("publish", { note_id: target, revision: saved.revision, days, password });
                setLink(result.public_origin + "/p/" + result.data.id);
                setItems((await request("list")).data);
                setAck(false);
              })
            }
          >
            {t("본문 사본 공개")}
          </button>
        </div>
        {manageShares && <SharingWorkspace publicationId={items[0]?.id} onClose={() => setManageShares(false)} />}
      </dialog>
    </>
  );
}
