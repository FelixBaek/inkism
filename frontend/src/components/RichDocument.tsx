import React, { useState, useEffect } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { editorLocation, rememberLocation } from "../lib/editor-location";
import { inspectRichHTML } from "../lib/rich-document";
import { RichEditor } from "./RichEditor";
import { errorText } from "../lib/text";
import { WindowedRichEditor } from "./WindowedRichEditor";
import { hasWindowHistory } from "../lib/window-history-cache";
import { t } from "../i18n";
import { MarkdownVisualDocument } from "./MarkdownVisualDocument";

export function RichDocument() {
  const s = useStore(),
    d = s.draft!;
  if (d.content_format === "markdown") return <MarkdownVisualDocument fallback={<WholeRichDocument />} />;
  if (s.windowedEditor && (s.largeDoc || hasWindowHistory(d.id, d.revision)) && (d.content_format ?? "html") === "html")
    return (
      <WindowedRichEditor
        id={d.id}
        readOnly={Boolean(d.readonly) || s.editorConverting}
        readDraft={s.readDraft}
        flush={s.flushNow}
        changeRange={s.changePaged}
        change={(content, windowEdit) => s.updateDraft({ content, textDirty: true, windowEdit })}
      />
    );
  return <WholeRichDocument />;
}

/** The mount key owns the initial body. Subsequent parent renders only update
 * callbacks/revision, never parse the entire live document again.
 */
function WholeRichDocument() {
  const s = useStore();
  const [snapshot] = useState(() => s.draft!);
  const [inspection] = useState(() =>
    (snapshot.content_format ?? "html") === "html" ? inspectRichHTML(snapshot.content) : null,
  );
  const [preview, setPreview] = useState<string | null>(inspection?.content ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (inspection || snapshot.isNew) return;
    let cancelled = false;
    void api
      .documentRender(snapshot.id, snapshot.revision)
      .then((result) => {
        if (!cancelled) setPreview(result.html);
      })
      .catch((error) => {
        if (!cancelled) setError(errorText(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const editable = Boolean(inspection?.editable);
  const copy = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await s.makeRichCopy();
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {!editable && (
        <div className="source-hint">
          <output>{t("원문은 그대로 보관합니다. 서식을 편집하려면 별도 사본을 만들어 주세요.")}</output>
          <button type="button" className="btn btn-small" disabled={busy} onClick={() => void copy()}>
            {t("서식 편집 사본 만들기")}
          </button>
          {error && (
            <p role="alert">{t("미리보기를 준비하지 못했습니다. 원문은 변경하지 않았습니다. {error}", { error })}</p>
          )}
        </div>
      )}
      {preview !== null ? (
        <RichEditor
          initialContent={preview}
          editable={editable}
          readOnly={Boolean(s.draft?.readonly) || s.editorConverting}
          navigationIdentity={{ id: snapshot.id, revision: s.draft?.revision ?? snapshot.revision }}
          noteIdentity={editable ? { id: snapshot.id, revision: s.draft?.revision ?? snapshot.revision } : undefined}
          initialSelection={editorLocation(snapshot.id, snapshot.revision, "rich")?.selection}
          onSelection={(selection) => {
            const current = s.readDraft();
            if (current?.id === snapshot.id)
              rememberLocation(current.id, { revision: current.revision, kind: "rich", offset: 0, selection });
          }}
          onChange={(content, text) => {
            const current = s.readDraft();
            if (
              editable &&
              !current?.readonly &&
              current?.id === snapshot.id &&
              (current.content_format ?? "html") === "html"
            )
              s.updateDraft({ content, text, textDirty: false });
          }}
        />
      ) : (
        <div className="editor-scroll">
          <p className="source-hint">{t("서식 미리보기를 준비하는 중…")}</p>
        </div>
      )}
    </>
  );
}
