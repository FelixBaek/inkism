import React, { useEffect, useState } from "react";
import { t } from "../i18n";
/** Bounded undo is distinct from canonical saves and saved version history. */
export function HistoryPersistenceNotice({ id }: Readonly<{ id: string }>) {
  const [message, setMessage] = useState("");
  useEffect(() => {
    setMessage("");
    const report = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; message: string }>).detail;
      if (detail.id === id.replace(/:split$/, "")) setMessage(detail.message);
    };
    window.addEventListener("inkism-history-limit", report);
    return () => window.removeEventListener("inkism-history-limit", report);
  }, [id]);
  if (!message) return null;
  return (
    <output className="history-limit-notice" style={{ display: "block" }}>
      {message}
      <button type="button" onClick={() => setMessage("")}>
        {t("알림 닫기")}
      </button>
    </output>
  );
}
