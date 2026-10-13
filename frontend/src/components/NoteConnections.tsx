import { referencePreview } from "../lib/reference-preview";
import { referenceRead } from "../lib/reference-read";
import { prepareHTMLBlockIdentity } from "../lib/block-identity";
import React, { useEffect, useRef, useState } from "react";
import { api, rpc, hasRpcDiagnostic } from "../api";
import { useStore } from "../store";
import { t } from "../i18n";
import { knowledge, parseReference, wikiReferences, type NoteReference } from "../lib/knowledge";
import { waitForAnchorEditor, navigateNoteAnchor, noteAnchors, requestResolvedAnchorRepair } from "../lib/note-anchor";
import { markdownToHTML } from "../lib/markdown";
import { sanitizeRichHtml } from "../lib/sanitize";
import type { Note } from "../types";
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
type IndexedReference = { reference: string; label: string; embed: boolean };
const indexedReference = (item: IndexedReference): NoteReference => ({
  ...parseReference(item.reference, item.embed),
  label: item.label || item.reference,
});
const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function exceedsReadBudget(error: unknown) {
  return hasRpcDiagnostic(error, "body_read_budget");
}

function connectionText(note: Note) {
  let result: NoteReference[] = [],
    plainContent = "";
  if ((note.content_format ?? "html") === "html") {
    const root = document.createElement("template");
    root.innerHTML = sanitizeRichHtml(note.content);
    root.content.querySelectorAll("pre,code,script,style").forEach((n) => n.remove());
    plainContent = root.content.textContent ?? "";
    result = wikiReferences(plainContent);
    for (const a of root.content.querySelectorAll('a[href^="note://"]')) {
      const ref = parseReference(a.getAttribute("href")!);
      ref.label = a.textContent || ref.label;
      result.push(ref);
    }
  } else {
    plainContent = note.content;
    result = wikiReferences(note.content);
    if (note.content_format === "markdown") {
      const root = document.createElement("template");
      root.innerHTML = markdownToHTML(note.content).content;
      root.content.querySelectorAll("pre,code").forEach((n) => n.remove());
      plainContent = root.content.textContent ?? "";
      result = wikiReferences(plainContent);
      for (const a of root.content.querySelectorAll('a[href^="note://"]')) {
        const ref = parseReference(a.getAttribute("href")!);
        ref.label = a.textContent || ref.label;
        result.push(ref);
      }
    }
  }
  const plain =
    (note.content_format ?? "html") === "html"
      ? plainContent
      : plainContent.replace(/```[\s\S]*?```/g, " ").replace(/[#*_`>[\]()]/g, " ");
  return { result, plain };
}

/** compact: the note-info panel form only; it skips the reference and mention scans that the full view runs on every save. */
export function NoteConnections({ onClose, compact = false }: { onClose: () => void; compact?: boolean }) {
  const s = useStore(),
    id = s.note!.id,
    latest = useRef(s);
  latest.current = s;
  const [refs, setRefs] = useState<NoteReference[]>([]),
    [unlinked, setUnlinked] = useState<{ id: string; title: string }[]>([]),
    [error, setError] = useState(""),
    [target, setTarget] = useState(""),
    [anchor, setAnchor] = useState(""),
    [label, setLabel] = useState(""),
    [embed, setEmbed] = useState(false),
    [busy, setBusy] = useState(false),
    [attempt, setAttempt] = useState(0);
  const [refPage, setRefPage] = useState(0),
    [mentionPage, setMentionPage] = useState(0),
    [indexCursor, setIndexCursor] = useState<string | null>(null),
    [mentionCursor, setMentionCursor] = useState<string | null>(null);
  const reads = useRef<AbortController | null>(null),
    indexedRevision = useRef<number | undefined>(undefined);
  const readIndexed = async (cursor?: string) => {
    const signal = reads.current?.signal;
    const info = await rpc<Awaited<ReturnType<typeof api.documentInfo>>>(
      "document_info",
      { id, ...(cursor ? { revision: indexedRevision.current } : {}) },
      { signal },
    );
    if (!cursor) indexedRevision.current = info.revision;
    const result = await rpc<{ ready: boolean; items: IndexedReference[]; next_cursor: string | null }>(
      "outgoing_references",
      { id, revision: info.revision, ...(cursor ? { cursor } : {}) },
      { signal },
    );
    if (!result.ready) throw new Error(t("문서를 준비 중입니다. 잠시 후 다시 열어 주세요."));
    return result;
  };
  const nextRefs = async () => {
    if ((refPage + 1) * 20 < refs.length) {
      setRefPage((p) => p + 1);
      return;
    }
    if (!indexCursor || busy) return;
    const controller = reads.current;
    setBusy(true);
    try {
      const result = await readIndexed(indexCursor);
      if (latest.current.note?.id !== id || controller !== reads.current || controller?.signal.aborted) return;
      setRefs((v) => [...v, ...result.items.map(indexedReference)]);
      setIndexCursor(result.next_cursor);
      setRefPage((p) => p + 1);
    } catch (e) {
      if (controller === reads.current && !controller?.signal.aborted) setError(errorText(e));
    } finally {
      if (controller === reads.current && !controller?.signal.aborted) setBusy(false);
    }
  };
  const readMentions = async (cursor?: string) => {
    const controller = reads.current;
    const items: { id: string; title: string }[] = [];
    let next = cursor;
    do {
      const result: { ready: boolean; items: { id: string; title: string }[]; next_cursor: string | null } = await rpc(
        "unlinked_mentions",
        { id, revision: indexedRevision.current, ...(next ? { cursor: next } : {}) },
        { signal: controller?.signal },
      );
      if (!result.ready) throw new Error(t("문서를 준비 중입니다. 잠시 후 다시 열어 주세요."));
      items.push(...result.items);
      next = result.next_cursor ?? undefined;
    } while (next && items.length < 20 && !controller?.signal.aborted);
    return { items, cursor: next ?? null };
  };
  const nextMentions = async () => {
    if (busy) return;
    const nextPage = mentionPage + 1,
      required = (nextPage + 1) * 20;
    if (unlinked.length >= required || !mentionCursor) {
      if (unlinked.length > nextPage * 20) setMentionPage(nextPage);
      return;
    }
    const controller = reads.current;
    setBusy(true);
    try {
      let cursor: string | null = mentionCursor;
      const added: { id: string; title: string }[] = [];
      do {
        const result = await readMentions(cursor ?? undefined);
        if (controller !== reads.current || controller?.signal.aborted) return;
        added.push(...result.items);
        cursor = result.cursor;
      } while (cursor && unlinked.length + added.length < required);
      setUnlinked((v) => [...v, ...added]);
      setMentionCursor(cursor);
      if (unlinked.length + added.length > nextPage * 20) setMentionPage(nextPage);
    } catch (e) {
      if (controller === reads.current && !controller?.signal.aborted) setError(errorText(e));
    } finally {
      if (controller === reads.current && !controller?.signal.aborted) setBusy(false);
    }
  };
  const [suggestions, setSuggestions] = useState<{ id: string; title: string }[]>([]),
    [anchors, setAnchors] = useState<string[]>([]);
  useEffect(() => {
    if (compact) return;
    let live = true;
    const controller = new AbortController();
    reads.current = controller;
    indexedRevision.current = undefined;
    const load = async () => {
      setBusy(false);
      setRefs([]);
      setUnlinked([]);
      setRefPage(0);
      setMentionPage(0);
      setIndexCursor(null);
      setMentionCursor(null);
      setError("");
      if (!(await latest.current.flushNow()) || !live) return;
      let note: Note;
      try {
        note = await rpc<Note>("get", { id, max_body_bytes: 2 * 1024 * 1024 }, { signal: controller.signal });
      } catch (e) {
        if (!exceedsReadBudget(e)) throw e;
        const result = await readIndexed();
        if (live) {
          setRefs(result.items.map(indexedReference));
          setIndexCursor(result.next_cursor);
        }
        const mentions = await readMentions();
        if (live) {
          setUnlinked(mentions.items);
          setMentionCursor(mentions.cursor);
        }
        return;
      }
      if (!live) return;
      const { result, plain } = connectionText(note);
      setRefs(result);
      const linked = new Set(result.map((ref) => ref.label.trim().toLocaleLowerCase()).filter(Boolean));
      const mentions: { id: string; title: string }[] = [];
      let cursor: string | undefined;
      const lowered = plain.toLocaleLowerCase();
      do {
        const metadata = await rpc<Awaited<ReturnType<typeof api.list>>>(
          "list",
          { view: "all", limit: 100, ...(cursor ? { cursor } : {}) },
          { signal: controller.signal },
        );
        if (!live) return;
        mentions.push(
          ...metadata.items
            .filter(
              (item) =>
                item.id !== id &&
                item.title.trim().length >= 2 &&
                lowered.includes(item.title.trim().toLocaleLowerCase()) &&
                !linked.has(item.title.trim().toLocaleLowerCase()),
            )
            .map((item) => ({ id: item.id, title: item.title })),
        );
        cursor = metadata.next_cursor ?? undefined;
      } while (cursor && live);
      setUnlinked(mentions);
    };
    load().catch((e) => {
      if (live) setError(errorText(e));
    });
    return () => {
      live = false;
      controller.abort();
    };
  }, [id, attempt, s.note?.revision, compact]);
  useEffect(() => {
    let live = true;
    knowledge
      .list()
      .then((x) => {
        if (live) setSuggestions(x.items.map((n) => ({ id: n.id, title: n.title })));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    setAnchors([]);
    if (target)
      api
        .get(target, { max_body_bytes: 2 * 1024 * 1024 })
        .then((n) => {
          if (live && new TextEncoder().encode(n.content).length <= 2 * 1024 * 1024)
            setAnchors(
              noteAnchors(n.content, n.content_format).map((a) => (a.kind === "heading" ? a.text : `^${a.id}`)),
            );
        })
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [target]);
  const prepareLinks = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (!(await s.flushNow())) throw new Error(t("먼저 노트를 저장해 주세요."));
      const snapshot = s.readDraft();
      if (!snapshot || snapshot.id !== id || snapshot.readonly) throw new Error(t("현재 노트를 편집할 수 없습니다."));
      const note = await api.get(id);
      if (note.revision !== snapshot.revision || s.readDraft() !== snapshot)
        throw new Error(t("문서가 변경되었습니다. 다시 시도해 주세요."));
      if ((note.content_format ?? "html") !== "html") return;
      if (new TextEncoder().encode(note.content).length > 8 * 1024 * 1024)
        throw new Error(t("연결 삽입은 8MB 이하 문서에서 사용할 수 있습니다."));
      const prepared = prepareHTMLBlockIdentity(note.content);
      if (prepared !== note.content) {
        s.stageWholeBody(snapshot, snapshot.revision, snapshot.paged?.version, prepared, note.content);
        if (!(await s.flushNow())) throw new Error(t("연결을 저장하지 못했습니다. 편집 내용에서 다시 저장해 주세요."));
      }
      setAttempt((x) => x + 1);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const append = async () => {
    if (busy || !target) return;
    setBusy(true);
    setError("");
    try {
      if (!(await s.flushNow())) throw new Error(t("먼저 노트를 저장해 주세요."));
      const snapshot = s.readDraft();
      if (!snapshot || snapshot.id !== id || snapshot.readonly) throw new Error(t("현재 노트를 편집할 수 없습니다."));
      const [note, destination] = await Promise.all([api.get(id), api.get(target)]);
      if (note.revision !== snapshot.revision || s.readDraft() !== snapshot)
        throw new Error(t("문서가 변경되었습니다. 다시 시도해 주세요."));
      if (new TextEncoder().encode(note.content).length > 8 * 1024 * 1024)
        throw new Error(t("연결 삽입은 8MB 이하 문서에서 사용할 수 있습니다."));
      const fragment = anchor ? `#${encodeURIComponent(anchor)}` : "",
        caption = label || destination.title || target;
      const embeddedTarget = `note://${target}${fragment}|${caption.replace(/[\]\n|]/g, "")}`;
      let addition: string;
      if ((note.content_format ?? "html") === "html")
        addition = embed
          ? `<p>![[${escape(embeddedTarget)}]]</p>`
          : `<p><a href="note://${target}${fragment}">${escape(caption)}</a></p>`;
      else
        addition = `\n\n${embed ? "!" : ""}[[note://${target}${fragment}${"|" + caption.replace(/[\]\n|]/g, "")}]]\n`;
      s.stageWholeBody(snapshot, snapshot.revision, snapshot.paged?.version, note.content + addition, note.content);
      if (!(await s.flushNow())) throw new Error(t("연결을 저장하지 못했습니다. 편집 내용에서 다시 저장해 주세요."));
      setAttempt((x) => x + 1);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  if (compact)
    return (
      <fieldset className="plain-fieldset note-connections-form" disabled={busy || Boolean(s.draft?.readonly)}>
        <label>
          {t("연결할 노트")}
          <select
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              setAnchor("");
            }}
          >
            <option value="">{t("노트 선택")}</option>
            {suggestions
              .filter((n) => n.id !== id)
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title || t("제목 없음")}
                </option>
              ))}
          </select>
        </label>
        <label>
          {t("제목 또는 문단")}
          <select aria-label={t("연결할 제목 또는 문단")} value={anchor} onChange={(e) => setAnchor(e.target.value)}>
            <option value="">{t("노트 전체")}</option>
            {anchors.map((a, i) => (
              <option key={`${a}-${i}`} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("링크 표시 이름")}
          <input value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <button type="button" className="btn" aria-pressed={embed} onClick={() => setEmbed((v) => !v)}>
          {t("내용 가져와 보기")}
        </button>
        {(s.note?.content_format ?? "html") === "html" && (
          <button type="button" className="btn" onClick={() => void prepareLinks()}>
            {t("이 노트의 문단 링크 준비")}
          </button>
        )}
        <button type="button" className="btn btn-primary" disabled={!target} onClick={() => void append()}>
          {t("노트 끝에 연결 추가")}
        </button>
        {error && <p role="alert">{error}</p>}
      </fieldset>
    );
  return (
    <section>
      <h3>{t("노트 연결과 내용 재사용")}</h3>
      <p>{t("참조한 원본의 최신 내용을 아래에서 확인합니다. 중첩 참조는 펼치지 않습니다.")}</p>
      <fieldset className="plain-fieldset" disabled={busy || Boolean(s.draft?.readonly)}>
        <div className="knowledge-row">
          <select
            aria-label={t("연결할 노트")}
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              setAnchor("");
            }}
          >
            <option value="">{t("노트 선택")}</option>
            {suggestions.map((n) => (
              <option key={n.id} value={n.id}>
                {n.title || t("제목 없음")}
              </option>
            ))}
          </select>
          <select aria-label={t("연결할 제목 또는 문단")} value={anchor} onChange={(e) => setAnchor(e.target.value)}>
            <option value="">{t("노트 전체")}</option>
            {anchors.map((a, i) => (
              <option key={`${a}-${i}`} value={a}>
                {a}
              </option>
            ))}
          </select>
          <input
            aria-label={t("링크 표시 이름")}
            placeholder={t("링크 표시 이름")}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <label>
            <input type="checkbox" checked={embed} onChange={(e) => setEmbed(e.target.checked)} />
            {t("내용 가져와 보기")}
          </label>
          <button className="btn" disabled={!target} onClick={() => void append()}>
            {t("노트 끝에 연결 추가")}
          </button>
        </div>
      </fieldset>
      {(s.note?.content_format ?? "html") === "html" && (
        <button className="btn" disabled={busy || Boolean(s.draft?.readonly)} onClick={() => void prepareLinks()}>
          {t("이 노트의 문단 링크 준비")}
        </button>
      )}
      {unlinked.length > 0 && (
        <section aria-label={t("연결되지 않은 언급")}>
          <h4>{t("연결되지 않은 언급")}</h4>
          <p>{t("본문에 노트 제목이 있지만 아직 링크되지 않았습니다.")}</p>
          <div className="knowledge-row">
            {unlinked.slice(mentionPage * 20, (mentionPage + 1) * 20).map((item) => (
              <button
                className="btn btn-secondary"
                key={item.id}
                disabled={busy}
                onClick={() => {
                  setTarget(item.id);
                  setLabel(item.title);
                  setAnchor("");
                }}
              >
                {item.title}
              </button>
            ))}
          </div>
          <button className="btn" disabled={mentionPage === 0} onClick={() => setMentionPage((p) => p - 1)}>
            {t("이전 언급")}
          </button>
          <button
            className="btn"
            disabled={busy || ((mentionPage + 1) * 20 >= unlinked.length && !mentionCursor)}
            onClick={() => void nextMentions()}
          >
            {t("다음 언급")}
          </button>
        </section>
      )}
      {error && <p role="alert">{error}</p>}
      <button className="btn" onClick={() => setAttempt((x) => x + 1)}>
        {t("참조 새로고침")}
      </button>
      {!refs.length && <p>{t("아직 나가는 링크가 없습니다.")}</p>}
      {refs.slice(refPage * 20, (refPage + 1) * 20).map((ref, i) => (
        <ResolvedReference
          key={`${attempt}-${refPage}-${i}-${ref.target}-${ref.anchor}`}
          reference={ref}
          currentId={id}
          onClose={onClose}
        />
      ))}
      {refs.length > 0 && (
        <div className="knowledge-row">
          <button className="btn" disabled={refPage === 0 || busy} onClick={() => setRefPage((p) => p - 1)}>
            {t("이전 연결")}
          </button>
          <span>{refPage + 1}</span>
          <button
            className="btn"
            disabled={busy || ((refPage + 1) * 20 >= refs.length && !indexCursor)}
            onClick={() => void nextRefs()}
          >
            {t("다음 연결")}
          </button>
        </div>
      )}
    </section>
  );
}
function ResolvedReference({
  reference,
  currentId,
  onClose,
}: {
  reference: NoteReference;
  currentId: string;
  onClose: () => void;
}) {
  const openRequest = useRef<AbortController | null>(null);
  useEffect(() => () => openRequest.current?.abort(), []);
  const [redirectSources, setRedirectSources] = useState<string[]>([]);
  const s = useStore(),
    [items, setItems] = useState<{ id: string; title: string }[]>([]),
    [error, setError] = useState(""),
    [html, setHtml] = useState<string | null>(null),
    [truncated, setTruncated] = useState(false),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    const load = async () => {
      const result = reference.target
        ? await knowledge.resolve(reference.target)
        : { items: [{ id: currentId, title: s.note?.title ?? "" }], ambiguous: false };
      if (!live) return;
      setItems(result.items);
      setRedirectSources("redirect_sources" in result ? (result.redirect_sources ?? []) : []);
      if ((reference.embed || reference.anchor) && result.items.length === 1) {
        const preview = await referenceRead(
          () =>
            referencePreview(
              result.items[0].id,
              reference.anchor,
              "redirect_sources" in result ? (result.redirect_sources ?? []) : [],
              controller.signal,
            ),
          controller.signal,
        );
        if (live && reference.embed) {
          setHtml(preview.html);
          setTruncated(preview.truncated);
        }
      }
    };
    load()
      .catch((e) => {
        if (live) setError(errorText(e));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [reference.target, reference.anchor, reference.embed, currentId]);
  const open = async (id: string, anchor = reference.anchor, sources = redirectSources) => {
    try {
      if (!(await s.flushNow())) return;
      openRequest.current?.abort();
      const controller = new AbortController();
      openRequest.current = controller;
      const preview = anchor
        ? await referenceRead(() => referencePreview(id, anchor, sources, controller.signal), controller.signal)
        : undefined;
      if (preview) {
        const current = await api.documentInfo(id, preview.note.revision);
        if (current.summary.trashed || ("locked" in current.summary && current.summary.locked))
          throw new Error(t("문서가 변경되었습니다. 다시 시도해 주세요."));
      }
      if (controller.signal.aborted || s.readDraft()?.id !== currentId) return;
      onClose();
      await s.selectNote(id);
      if (preview) {
        await waitForAnchorEditor();
        const draft = s.readDraft();
        const note =
          preview.note.content_format === "markdown" && draft?.id === id
            ? { ...preview.note, content: draft.content, text: draft.text }
            : preview.note;
        await navigateNoteAnchor(note, preview.anchor ?? decodeURIComponent(anchor), sources);
      }
    } catch (e) {
      void s.showError(t("노트 연결"), errorText(e));
    }
  };
  const embedView = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = embedView.current;
    if (!element) return;
    const followLink = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest("a");
      const href = link?.getAttribute("href");
      if (!href?.startsWith("note://")) return;
      event.preventDefault();
      const ref = parseReference(href);
      void knowledge
        .resolve(ref.target)
        .then((result) => {
          if (result.items.length === 1) void open(result.items[0].id, ref.anchor, result.redirect_sources ?? []);
        })
        .catch((error) => setError(errorText(error)));
    };
    element.addEventListener("click", followLink);
    return () => element.removeEventListener("click", followLink);
  }, [html, open]);
  return (
    <div className="knowledge-reference">
      <strong>{reference.label}</strong>
      {loading && <span> · {t("불러오는 중…")}</span>}
      {error && <p role="alert">{error}</p>}
      {reference.anchor && items.length === 1 && (
        <button
          className="btn"
          onClick={() =>
            void api
              .get(items[0].id, { max_body_bytes: 2 * 1024 * 1024 })
              .then((note) => requestResolvedAnchorRepair(note, decodeURIComponent(reference.anchor), redirectSources))
              .catch((e) => setError(errorText(e)))
          }
        >
          {t("문단 연결 복구")}
        </button>
      )}
      {!loading && !items.length && <p>{t("대상 노트를 찾지 못했습니다.")}</p>}
      {items.length > 1 && <p>{t("같은 이름이 여러 개입니다. 열 노트를 선택해 주세요.")}</p>}
      {items.map((n) => (
        <button className="btn" key={n.id} onClick={() => void open(n.id)}>
          {n.title || t("제목 없음")}
        </button>
      ))}
      {truncated && <p>{t("큰 참조는 일부만 미리 표시합니다. 전체 내용은 노트를 열어 확인하세요.")}</p>}
      {html !== null && (
        <div
          className="knowledge-embed"
          aria-label={t("참조한 노트 내용")}
          dangerouslySetInnerHTML={{ __html: html }}
          ref={embedView}
        />
      )}
    </div>
  );
}
