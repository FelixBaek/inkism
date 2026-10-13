import { useEffect, useState } from "react";
import { useStore } from "../store";
import { knowledge, type NoteKnowledge } from "../lib/knowledge";
import { CoverPicker, UnsplashKeySettings } from "./NotebookCover";
import type { NotebookCover } from "../types";
import { t } from "../i18n";

/** 설정 › 사진 검색 (Figma 38): Unsplash 키 + 지금 연 노트의 표지 사진(문서 설정 document.cover). */
export function PhotoSettings() {
  const s = useStore();
  const note = s.note && s.draft?.id === s.note.id && !s.draft.isNew ? s.note : null;
  const [meta, setMeta] = useState<NoteKnowledge | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    setMeta(null);
    setMessage("");
    if (!note) return;
    let alive = true;
    knowledge
      .get(note.id)
      .then((v) => alive && setMeta(v))
      .catch((e) => alive && setMessage(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [note?.id, note?.revision]); // eslint-disable-line react-hooks/exhaustive-deps
  const change = async (cover: NotebookCover | null) => {
    if (!note || !meta) return;
    setBusy(true);
    setMessage("");
    try {
      setMeta(await knowledge.set({ ...meta, document: { ...meta.document, cover } }, note.revision));
      window.dispatchEvent(new Event("inkism-knowledge-changed")); // 편집기 위 표지를 바로 바꾼다
      setMessage(cover ? t("표지 사진을 넣었어요.") : t("표지 사진을 뺐어요."));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="settings-card unsplash-card">
        <div className="settings-card__text">
          <strong>{t("Unsplash 사진 검색")}</strong>
          <p>
            {t(
              "폴더 표지 사진을 Unsplash에서 찾을 때 씁니다. 키는 이 기기의 앱 안에만 보관하고 화면에는 다시 보여 주지 않습니다. unsplash.com/developers에서 앱을 만들고 Access Key를 넣어 주세요.",
            )}
          </p>
        </div>
        <UnsplashKeySettings />
      </div>
      <div className="settings-card">
        <div className="settings-card__text">
          <strong>{t("표지 사진 사용")}</strong>
          {note && meta ? (
            <fieldset className="plain-fieldset photo-settings__picker" disabled={busy}>
              <CoverPicker value={meta.document?.cover ?? null} onChange={(c) => void change(c)} onBusy={setBusy} />
            </fieldset>
          ) : null}
          {message && (
            <p>
              <output>{message}</output>
            </p>
          )}
          <p>
            {note
              ? t("고른 사진은 지금 연 노트 「{title}」의 표지로 저장돼요. 사진 작가 이름과 Unsplash 링크도 함께 보관해요.", {
                  title: note.title || t("제목 없음"),
                })
              : t("노트를 열고 저장한 뒤 여기서 그 노트의 표지 사진을 고를 수 있어요.")}
          </p>
        </div>
      </div>
    </>
  );
}
