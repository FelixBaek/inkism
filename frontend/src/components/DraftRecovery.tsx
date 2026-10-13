import React, { useState } from "react";
import { useStore } from "../store";
import { downloadDraftRecovery } from "../lib/draft-recovery";
import { t } from "../i18n";

export function DraftRecovery() {
  const s = useStore();
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const save = () => {
    try {
      window.dispatchEvent(new Event("inkism-flush-editor"));
      const draft = s.readDraft();
      if (!draft) return;
      downloadDraftRecovery(draft);
      setFailed(false);
      setMessage(
        draft.paged
          ? t(
              "편집한 구간의 보관 파일을 다운로드합니다. 문서 전체 백업은 아닙니다. ‘편집 보관 파일 가져오기’로 복구할 수 있습니다.",
            )
          : t("현재 본문의 보관 파일을 다운로드합니다. ‘편집 보관 파일 가져오기’로 복구할 수 있습니다."),
      );
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : t("편집을 보관하지 못했습니다."));
    }
  };
  return (
    <span className="draft-recovery">
      <button type="button" className="btn btn-ghost" onClick={save}>
        {t("미저장 편집 파일로 보관")}
      </button>
      {message && <span role={failed ? "alert" : "status"}>{message}</span>}
    </span>
  );
}
