import { useEffect, useRef, useState } from "react";
import { X } from "../icons";
import { useStore } from "../store";
import { t } from "../i18n";
import { DraftRecovery } from "./DraftRecovery";
import "./SharingDialogs.css";
import "./SaveProtection.css";

/** 저장 실패·충돌 때 편집 영역 위의 경고 띠와 "현재 편집을 보관할까요?" 팝업. 편집 내용은 그대로 둔다. */
export function SaveProtection() {
  const s = useStore();
  const conflict = s.saveState === "conflict";
  const failed = conflict || s.saveState === "error";
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  // 충돌은 고르기 전엔 풀리지 않으니 바로 연다. 일반 저장 실패는 다른 작업을 막지 않게 띠만 보여 준다.
  useEffect(() => setOpen(conflict), [conflict]);
  useEffect(() => {
    if (!failed) setOpen(false);
  }, [failed]);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
    // 실패 상태가 잠깐 풀렸다 돌아오면 dialog가 새로 붙으므로 다시 맞춘다.
  }, [open, failed]);
  if (!failed) return null;
  return (
    <>
      <p className="save-band" role="alert">
        {conflict
          ? t("다른 기기에서 바뀐 내용과 충돌했습니다. 현재 편집은 유지됩니다.")
          : t("저장하지 못했습니다. 현재 편집은 유지됩니다.")}
        {!conflict && (
          <button type="button" className="save-band-action" onClick={s.retrySave}>
            {t("다시 저장")}
          </button>
        )}
        {!open && <DraftRecovery />}
        <button type="button" className="save-band-action" onClick={() => setOpen(true)}>
          {t("보관 방법 보기")}
        </button>
      </p>
      <dialog
        ref={dialog}
        className="sharing-dialog dialog save-protection"
        aria-labelledby="save-protection-title"
        onCancel={(e) => {
          e.preventDefault();
          setOpen(false);
        }}
      >
        <div className="dialog-title-row">
          <h2 id="save-protection-title" className="dialog-title">
            {t("현재 편집을 보관할까요?")}
          </h2>
          <button type="button" className="icon-btn" aria-label={t("대화상자 닫기")} onClick={() => setOpen(false)}>
            <X size={16} aria-hidden />
          </button>
        </div>
        <p className="dialog-note dialog-note-warning">
          {conflict
            ? t("다른 기기에서 바뀐 내용과 충돌했습니다. 입력한 내용은 이 화면에 남아 있습니다.")
            : t("저장에 실패했습니다. 입력한 내용은 이 화면에 남아 있습니다.")}
        </p>
        {conflict && (
          <>
            <div className="save-protection-choices">
              <button type="button" className="btn" onClick={() => { setOpen(false); s.keepLocalVersion(); }}>
                {t("내 편집 유지하고 저장")}
              </button>
              <button type="button" className="btn" onClick={() => { setOpen(false); s.useServerVersion(); }}>
                {t("서버 버전으로 교체")}
              </button>
            </div>
            <p className="dialog-note">{t("서버 버전으로 교체하기 전에 초안을 보관할 수 있어요.")}</p>
          </>
        )}
        <div className="dialog-actions">
          <DraftRecovery />
          <span className="dialog-actions-gap" />
          {!conflict && (
            <button type="button" className="btn btn-primary" onClick={s.retrySave}>
              {t("다시 저장")}
            </button>
          )}
        </div>
      </dialog>
    </>
  );
}
