import { useRef } from "react";
import { Loader2 } from "../icons";
import { useStore } from "../store";
import { t } from "../i18n";
import { MarkdownImport } from "./MarkdownImport";

/** 노트를 열지 않았을 때의 편집 영역(첫 실행 화면). 새 노트·가져오기·복원·동기화 연결로 바로 이어 준다. */
export function EmptyWorkspace() {
  const s = useStore();
  const backup = useRef<HTMLInputElement>(null);
  if (s.draftLoading)
    return (
      <main className="editor-pane editor-empty" aria-label={t("편집기")} id="note-editor-panel">
        <div className="empty-state">
          <Loader2 size={28} className="spin" aria-hidden />
          <p className="empty-title">{t("노트를 불러오는 중…")}</p>
        </div>
      </main>
    );
  const first = s.stats?.notes === 0;
  return (
    <main className="editor-pane editor-empty" aria-label={t("편집기")} id="note-editor-panel">
      <div className="empty-state">
        <p className="empty-title">{first ? t("아직 노트가 없습니다.") : t("노트를 선택하세요")}</p>
        <p className="empty-sub">
          {first ? t("새 노트를 만들거나, 가지고 있는 기록을 가져오세요.") : t("목록에서 노트를 선택하거나 새 노트를 만들어 보세요")}
        </p>
        <div className="empty-actions">
          <button type="button" className="btn btn-primary" aria-label={t("새 노트 만들기")} onClick={() => s.newNote()}>
            {t("새 노트")}
          </button>
          <MarkdownImport className="btn" />
          <button
            type="button"
            className="btn btn-ghost"
            disabled={s.importing}
            onClick={() => backup.current?.click()}
          >
            {s.importing ? t("가져오는 중…") : t("백업 파일에서 복원")}
          </button>
          <input
            ref={backup}
            type="file"
            accept=".json,.zip,application/json,application/zip"
            hidden
            aria-hidden="true"
            tabIndex={-1}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void s.importBackup(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => window.dispatchEvent(new CustomEvent("inkism-open-settings", { detail: "sync" }))}
          >
            {t("다른 기기와 동기화 연결")}
          </button>
        </div>
        <ul className="empty-hints" aria-label={t("단축키")}>
          <li><kbd>Ctrl+N</kbd>{t("새 노트")}</li>
          <li><kbd>Ctrl+P</kbd>{t("노트 검색")}</li>
          <li><kbd>Ctrl+/</kbd>{t("단축키 보기")}</li>
        </ul>
      </div>
    </main>
  );
}
