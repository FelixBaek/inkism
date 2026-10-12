import React, { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { api, RpcError } from "../api";
import type { Draft, DocumentFindResult } from "../types";
import { t } from "../i18n";
interface Props {
  id: string;
  readDraft: () => Draft | null;
  flush: () => Promise<boolean>;
  reveal: (ordinal: number, revision: number, query: string, sensitive: boolean) => Promise<void>;
}
function errorText(e: unknown, conflict: string) {
  if (e instanceof RpcError && e.isConflict) return conflict;
  return e instanceof Error ? e.message : String(e);
}
/** Whole-document lookup; only a bounded result page is rendered. */
export function DocumentSearch({ id, readDraft, flush, reveal }: Readonly<Props>) {
  const store = useStore();
  const [replacement, setReplacement] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [replaceMessage, setReplaceMessage] = useState("");
  const cancelReplace = useRef(false),
    runningReplace = useRef(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sensitive, setSensitive] = useState(false);
  const [result, setResult] = useState<DocumentFindResult | null>(null);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const alive = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const runRef = useRef<(offset?: number) => Promise<void>>(async () => {});
  const stale = (request: number) => !alive.current || request !== seq.current;
  /** Flushes, then polls the server until the result page is ready; null when superseded. */
  const findReady = async (request: number, nextOffset: number) => {
    if (!(await flush())) throw new Error(t("저장을 완료한 뒤 다시 검색해 주세요."));
    if (stale(request)) return null;
    const draft = readDraft();
    if (draft?.id !== id) return null;
    const version = draft.paged?.version;
    let response = await api.documentFind(id, draft.revision, query, {
      offset: nextOffset,
      case_sensitive: sensitive,
    });
    const deadline = Date.now() + 60000;
    while (!response.ready && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (stale(request)) return null;
      response = await api.documentFind(id, draft.revision, query, { offset: nextOffset, case_sensitive: sensitive });
    }
    if (stale(request)) return null;
    if (!response.ready) throw new Error(t("검색 내용을 준비 중입니다. 잠시 후 다시 시도해 주세요."));
    if (
      readDraft()?.revision !== response.revision ||
      readDraft()?.content !== draft.content ||
      draft.paged?.version !== version
    )
      throw new Error(t("문서가 변경되었습니다. 다시 검색해 주세요."));
    return response;
  };
  const run = async (nextOffset = 0) => {
    clearTimeout(timer.current);
    const request = ++seq.current;
    if (!query) {
      setResult(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await findReady(request, nextOffset);
      if (!response) return;
      setResult(response);
      setOffset(nextOffset);
    } catch (e) {
      if (!stale(request)) {
        setResult(null);
        setError(errorText(e, t("문서가 변경되었습니다. 다시 검색해 주세요.")));
      }
    } finally {
      if (!stale(request)) setBusy(false);
    }
  };
  runRef.current = run;
  useEffect(() => {
    seq.current++;
    setResult(null);
    setError(null);
    if (open && query) timer.current = setTimeout(() => void runRef.current(), 300);
    else setBusy(false);
    return () => clearTimeout(timer.current);
  }, [open, query, sensitive]);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      seq.current++;
      clearTimeout(timer.current);
    };
  }, []);
  const select = async (ordinal: number) => {
    if (!result) return;
    try {
      await reveal(ordinal, result.revision, query, sensitive);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e));
    }
  };
  const replaceAll = async () => {
    if (runningReplace.current || !query || readDraft()?.readonly) return;
    runningReplace.current = true;
    cancelReplace.current = false;
    setReplacing(true);
    setError(null);
    setReplaceMessage("");
    try {
      if (!(await flush())) throw new Error(t("저장을 완료한 뒤 전체 바꾸기를 실행해 주세요."));
      const draft = readDraft();
      if (draft?.id !== id) return;
      const revision = draft.revision,
        version = draft.paged?.version;
      const check = () => {
        if (!alive.current || cancelReplace.current) throw new Error(t("전체 바꾸기를 취소했습니다."));
        window.dispatchEvent(new Event("inkism-flush-editor"));
        const current = readDraft();
        if (current !== draft || current.revision !== revision || current.paged?.version !== version)
          throw new Error(t("편집 내용이 변경되어 전체 바꾸기를 취소했습니다."));
      };
      const { replaceDocument } = await import("../lib/replace-document");
      const result = await replaceDocument(id, revision, query, replacement, sensitive, check, (done, total) => {
        if (alive.current) setReplaceMessage(t("{done} / {total} 구간 처리 중", { done, total }));
      });
      check();
      if (result.count) {
        store.stageWholeBody(draft, revision, version, result.content, result.before);
      } else setReplaceMessage(t("바꿀 내용이 없습니다."));
    } catch (e) {
      if (alive.current) setError(errorText(e, t("다른 곳에서 문서가 변경되어 전체 바꾸기를 취소했습니다.")));
    } finally {
      runningReplace.current = false;
      if (alive.current) setReplacing(false);
    }
  };
  return (
    <section className="document-search" aria-label={t("문서 전체 검색")}>
      <button
        type="button"
        className="btn btn-secondary"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {t("문서 전체 찾기")}
      </button>
      {open && (
        <>
          <form
            className="document-search-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run();
            }}
          >
            <input
              ref={input}
              aria-label={t("문서 전체에서 찾을 내용")}
              placeholder={t("문서 전체에서 찾기")}
              value={query}
              maxLength={200}
              disabled={replacing}
              onChange={(event) => {
                seq.current++;
                setQuery(event.target.value);
              }}
            />
            <label>
              <input
                type="checkbox"
                disabled={replacing}
                checked={sensitive}
                onChange={(event) => {
                  seq.current++;
                  setSensitive(event.target.checked);
                }}
              />
              {t("대소문자 구분")}
            </label>
            <button type="submit" className="btn btn-secondary" disabled={busy || !query}>
              {t("검색")}
            </button>
          </form>
          <div className="document-search-form">
            <input
              aria-label={t("문서 전체에서 바꿀 내용")}
              value={replacement}
              disabled={replacing}
              onChange={(e) => setReplacement(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-secondary"
              disabled={replacing || busy || !query || readDraft()?.readonly}
              onClick={() => void replaceAll()}
            >
              {t("문서 전체 바꾸기")}
            </button>
            {replacing && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  cancelReplace.current = true;
                }}
              >
                {t("전체 바꾸기 취소")}
              </button>
            )}
          </div>
          {replaceMessage && (
            <p>
              <output>{replaceMessage}</output>
            </p>
          )}
          {busy && (
            <p>
              <output>{t("문서 전체에서 찾는 중…")}</output>
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          {result && (
            <>
              {!result.items.length && (
                <p>
                  <output>{t("검색 결과가 없습니다.")}</output>
                </p>
              )}
              <ul className="document-search-results">
                {result.items.map((item) => (
                  <li key={item.ordinal}>
                    <button
                      type="button"
                      aria-label={t("검색 결과: 블록 {n}", { n: item.ordinal + 1 })}
                      onClick={() => void select(item.ordinal)}
                    >
                      <strong>{t("블록 {n}", { n: item.ordinal + 1 })}</strong>
                      <span>{item.snippet}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {offset > 0 && (
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void run()}>
                  {t("처음 결과")}
                </button>
              )}
              {result.next_offset !== null && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => void run(result.next_offset!)}
                >
                  {t("다음 결과")}
                </button>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
