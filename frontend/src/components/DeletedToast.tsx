import { useEffect } from "react";
import { useStore } from "../store";
import { t } from "../i18n";
import "./DeletedToast.css";

const SHOW_MS = 8000;

function editable(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

/** 지운 직후 알림(Figma 10d): 아래쪽 가운데, 되돌리기 버튼과 Ctrl Z. */
export function DeletedToast() {
  const s = useStore();
  const deleted = s.deletedNote;
  const { undoTrash, dismissDeleted } = s;
  useEffect(() => {
    if (!deleted) return;
    const timer = window.setTimeout(dismissDeleted, SHOW_MS);
    // 글 입력 칸의 Ctrl Z는 그 칸의 실행취소다.
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "z" || editable(e.target)) return;
      e.preventDefault();
      void undoTrash();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [deleted, undoTrash, dismissDeleted]);
  if (!deleted) return null;
  return (
    <div className="deleted-toast" role="status" aria-live="polite">
      <span className="deleted-toast-text">
        {t("‘{title}’을 지웠습니다 · 보관함 › 지운 노트에 있어요", { title: deleted.title || t("제목 없음") })}
      </span>
      <button type="button" className="deleted-toast-undo" onClick={() => void undoTrash()}>
        {t("되돌리기")}
        <kbd>Ctrl Z</kbd>
      </button>
    </div>
  );
}
