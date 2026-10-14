import { t } from "../i18n";
import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, History, LockKeyhole, X } from "../icons";
import { useStore } from "../store";
import { api } from "../api";
import type { HistoryEntry, NotebookCover } from "../types";
import { formatDateTime } from "../lib/date";
import { diffLines, toLines, type DiffResult } from "../lib/version-diff";
import { RemoteHistoryPanel } from "./RemoteHistoryPanel";
import { CoverPicker } from "./NotebookCover";

const NOTEBOOK_COLORS = ["#087f5b", "#0b7285", "#3b5bdb", "#7048e8", "#c2255c", "#d9480f", "#b08968", "#5c6f68"];

function dialogClassName(d: NonNullable<ReturnType<typeof useStore>["dialog"]>) {
  if (d.kind === "history") return "dialog dialog-wide";
  if (d.kind === "prompt" && d.options.withCover) return "dialog dialog-cover";
  return "dialog";
}

/** 대화상자 제목 줄: 제목 + 오른쪽 닫기 버튼. */
function DialogHead({ danger, children }: Readonly<{ danger?: boolean; children: React.ReactNode }>) {
  const store = useStore();
  return (
    <div className="dialog-title-row">
      <h2 id="dialog-title" className={`dialog-title ${danger ? "danger" : ""}`}>
        {children}
      </h2>
      {/* 처음 초점은 입력칸이나 동작 버튼에 둔다 */}
      <button type="button" className="icon-btn" data-head-close aria-label={t("대화상자 닫기")} onClick={() => store.closeDialog()}>
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}

/** 접근 가능한 대화상자 호스트. confirm()/prompt() 대신 이 구조를 사용한다. */
export function DialogHost() {
  const store = useStore();
  const dialogRef = useRef<HTMLDivElement>(null);
  const lastFocused = useRef<Element | null>(null);

  useEffect(() => {
    if (!store.dialog) return;
    lastFocused.current = document.activeElement;
    const el = dialogRef.current;
    const focusable = el?.querySelector<HTMLElement>("input, button:not([data-head-close]), [tabindex]:not([tabindex='-1'])");
    (focusable ?? el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.key === "Process") return;
      if (e.key === "Escape") {
        e.stopPropagation();
        store.closeDialog();
      } else if (e.key === "Tab" && el) {
        const nodes = Array.from(el.querySelectorAll<HTMLElement>("input, button, select, textarea, a[href]")).filter(
          (n) => !n.hasAttribute("disabled"),
        );
        if (nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      const prev = lastFocused.current as HTMLElement | null;
      prev?.focus?.();
    };
  }, [store.dialog]);

  if (!store.dialog) return null;
  const d = store.dialog;

  return (
    <TopLayer>
      <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && store.closeDialog()}>
        <div
          className={dialogClassName(d)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="dialog-title"
          ref={dialogRef}
          tabIndex={-1}
        >
          {d.kind === "confirm" && (
            <>
              <DialogHead danger={d.options.danger}>
                {d.options.danger && <AlertTriangle size={18} aria-hidden />}
                {d.options.title}
              </DialogHead>
              <p className="dialog-message">{d.options.message}</p>
              <div className="dialog-actions">
                <button type="button" className="btn" onClick={() => store.closeDialog()}>
                  {d.options.cancelLabel ?? t("취소")}
                </button>
                <button
                  type="button"
                  className={`btn ${d.options.danger ? "btn-danger" : "btn-primary"}`}
                  onClick={() => {
                    d.resolve(true);
                    store.closeDialog();
                  }}
                >
                  {d.options.confirmLabel ?? t("확인")}
                </button>
              </div>
            </>
          )}

          {d.kind === "prompt" && <PromptForm key="prompt" />}

          {d.kind === "error" && (
            <>
              <DialogHead danger>
                <AlertTriangle size={18} aria-hidden />
                {d.title}
              </DialogHead>
              <p className="dialog-message">{d.message}</p>
              <div className="dialog-actions">
                <button type="button" className="btn btn-primary" onClick={() => store.closeDialog()}>
                  {t("확인")}
                </button>
              </div>
            </>
          )}

          {d.kind === "imported" && (
            <>
              <DialogHead>{t("백업 가져오기 완료")}</DialogHead>
              <p className="dialog-message">
                {t("{n}개의 노트를 가져왔습니다. 기존 노트와 중복되지 않는 새 노트로 추가되었습니다.", { n: d.count })}
              </p>
              <div className="dialog-actions">
                <button type="button" className="btn btn-primary" onClick={() => store.closeDialog()}>
                  {t("확인")}
                </button>
              </div>
            </>
          )}

          {d.kind === "history" && <HistoryPanel noteId={d.noteId} initialId={d.historyId} />}
        </div>
      </div>
    </TopLayer>
  );
}

function PromptForm() {
  const store = useStore();
  const d = store.dialog;
  const [value, setValue] = useState(d?.kind === "prompt" ? (d.options.initial ?? "") : "");
  const [color, setColor] = useState(
    d?.kind === "prompt" ? (d.options.initialColor ?? NOTEBOOK_COLORS[0]) : NOTEBOOK_COLORS[0],
  );
  const [cover, setCover] = useState<NotebookCover | null>(
    d?.kind === "prompt" ? (d.options.initialCover ?? null) : null,
  );
  const [description, setDescription] = useState(d?.kind === "prompt" ? (d.options.initialDescription ?? "") : "");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  if (d?.kind !== "prompt") return null;

  const submit = () => {
    if (busy) return;
    d.resolve({
      value,
      color,
      ...(d.options.withCover ? { cover } : {}),
      ...(d.options.withDescription ? { description } : {}),
    });
    store.closeDialog();
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <DialogHead>{d.options.title}</DialogHead>
      <p className="dialog-message">{d.options.message}</p>
      <label className="field-label" htmlFor="dialog-field">
        {d.options.label}
      </label>
      <input
        id="dialog-field"
        ref={inputRef}
        className="text-field"
        type="text"
        value={value}
        placeholder={d.options.placeholder}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
        required={!d.options.allowEmpty}
      />
      {d.options.withDescription && (
        <>
          <label className="field-label" htmlFor="dialog-description">
            {t("설명")}
          </label>
          <textarea
            id="dialog-description"
            className="text-field"
            rows={3}
            style={{ resize: "vertical" }}
            maxLength={1000}
            value={description}
            placeholder={t("이 폴더에 대한 짧은 설명 (선택)")}
            onChange={(e) => setDescription(e.target.value)}
          />
        </>
      )}
      {d.options.withColor && (
        <>
          <span className="field-label" id="color-label">
            {t("색상")}
          </span>
          <div className="color-row" role="radiogroup" aria-labelledby="color-label">
            {NOTEBOOK_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={t("색상 {color}", { color: c })}
                className={`color-swatch ${color === c ? "selected" : ""}`}
                style={{ backgroundColor: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </>
      )}
      {d.options.withCover && <CoverPicker value={cover} onChange={setCover} onBusy={setBusy} />}
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={() => store.closeDialog()}>
          {d.options.cancelLabel ?? t("취소")}
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {d.options.confirmLabel ?? t("확인")}
        </button>
      </div>
    </form>
  );
}

/** 버전 기록: 왼쪽 목록에서 버전을 고르면 그 버전과 지금 저장된 노트를 문단 단위로 나란히 비교한다. */
function HistoryPanel({ noteId, initialId }: Readonly<{ noteId: string; initialId?: string }>) {
  const store = useStore();
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(initialId ?? null);
  const [compare, setCompare] = useState<
    { id: string; old: string; oldFormat?: string; diff: DiffResult } | { id: string; error: string } | null
  >(null);
  const [copying, setCopying] = useState(false);
  const [versionName,setVersionName]=useState("");
  const [naming,setNaming]=useState(false);
  const [sealed,setSealed]=useState<{id:string;label:string;created_at:number}[]>([]);
  useEffect(()=>{let alive=true;api.sealedHistory(noteId).then(v=>alive&&setSealed(v),()=>alive&&setSealed([]));return()=>{alive=false;};},[noteId]);
  const changeNamed=async(kind:"create"|"rename"|"delete")=>{
    if(naming)return;setNaming(true);setError(null);
    try{
      if(!await store.flushNow())throw new Error(t("먼저 노트를 저장해 주세요."));
      const current=await api.documentInfo(noteId);
      const selectedEntry=entries?.find(h=>h.id===selected);
      let result:{id:string};
      if(kind==="create")result=await api.nameCurrentVersion(noteId,current.revision,versionName);
      else {if(!selectedEntry?.label)return;result=kind==="rename"?await api.renameVersion(noteId,current.revision,selectedEntry.id,selectedEntry.label,versionName):await api.deleteNamedVersion(noteId,current.revision,selectedEntry.id,selectedEntry.label);}
      const history=await api.history(noteId);setEntries(history);setSelected(kind==="delete"?history[0]?.id??null:result.id);setVersionName("");
    }catch(e){setError(String(e));}finally{setNaming(false);}
  };

  useEffect(() => {
    let alive = true;
    api
      .history(noteId)
      .then((h) => {
        if (!alive) return;
        setEntries(h);
        setSelected((cur) => cur ?? h[0]?.id ?? null);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : t("기록을 불러올 수 없습니다"));
      });
    return () => {
      alive = false;
    };
  }, [noteId]);

  const entry = entries?.find((h) => h.id === selected) ?? null;
  useEffect(() => {
    if (!entry) return;
    let alive = true;
    setCompare(null);
    void Promise.all([api.historyBody(noteId, entry.id), api.get(noteId)])
      .then(([old, current]) => {
        if (!alive) return;
        const oldFormat = (old as { content_format?: string }).content_format ?? entry.content_format;
        const diff = diffLines(toLines(old.content, oldFormat), toLines(current.content, current.content_format));
        setCompare({ id: entry.id, old: old.content, oldFormat, diff });
      })
      .catch(
        (e) =>
          alive &&
          setCompare({ id: entry.id, error: e instanceof Error ? e.message : t("버전을 불러오지 못했습니다") }),
      );
    return () => {
      alive = false;
    };
  }, [entry, noteId]);

  const saveCopy = async () => {
    if (!entry || !compare || "error" in compare || copying) return;
    setCopying(true);
    try {
      const base = store.note;
      const copy = await api.save({
        id: crypto.randomUUID(),
        title: (entry.title || "제목 없음") + " (이전 버전 사본)",
        content: compare.old,
        content_format: (compare.oldFormat as "html" | "markdown" | "text" | undefined) ?? "html",
        notebook_id: base?.notebook_id ?? null,
        tags: base?.tags ?? [],
      });
      store.closeDialog();
      store.refreshList();
      void store.selectNote(copy.id);
    } catch (e) {
      setCompare({ id: entry.id, error: e instanceof Error ? e.message : t("사본을 저장하지 못했습니다") });
    } finally {
      setCopying(false);
    }
  };

  const diff = compare && !("error" in compare) ? compare.diff : null;
  return (
    <>
      <div className="dialog-title-row">
        <h2 id="dialog-title" className="dialog-title">
          <History size={18} aria-hidden />
          {t("버전 기록")}
        </h2>
        <button type="button" className="icon-btn" aria-label={t("대화상자 닫기")} onClick={() => store.closeDialog()}>
          <X size={16} aria-hidden />
        </button>
      </div>
      <RemoteHistoryPanel key={noteId} noteId={noteId} />
      <section aria-label={t("이름 붙인 버전")}>
        <p>{t("이름 붙인 버전은 자동 정리하지 않습니다. 동기화가 켜져 있으면 이 노트를 동기화하는 기기와 함께 동기화되며, 금고에 있는 노트의 버전은 암호화된 상태로 유지됩니다. 라이브러리 백업에도 포함됩니다.")}</p>
        <p>{t("노트당 최대 100개·64 MiB입니다. 노트를 잠그면 보관 버전 본문도 함께 암호화합니다.")}</p>
        <label>{t("버전 이름")}<input aria-label={t("버전 이름")} maxLength={120} value={versionName} onChange={e=>setVersionName(e.target.value)} /></label>
        <button className="btn" disabled={naming||!versionName.trim()} onClick={()=>void changeNamed("create")}>{t("현재 버전 보관")}</button>
        {entry?.label&&<><button className="btn" disabled={naming||!versionName.trim()} onClick={()=>void changeNamed("rename")}>{t("버전 이름 변경")}</button><button className="btn" disabled={naming} onClick={()=>void changeNamed("delete")}>{t("선택한 보관 버전 삭제")}</button></>}
      </section>
      {sealed.length>0&&(
        <section className="history-sealed" role="note" aria-label={t("암호화된 채로 보관된 버전")}>
          <strong><LockKeyhole size={14} aria-hidden /> {t("암호화된 채로 보관된 버전 {n}개",{n:sealed.length})}</strong>
          <p>{t("금고에 보관됐을 때 만든 버전입니다. 지워지지 않았고 암호화된 상태 그대로 보관되어 있지만, 이 노트가 지금 금고 밖에 있어 이 목록에서는 열 수 없습니다.")}</p>
          <p>{t("보려면 금고를 연 뒤 이 노트를 다시 금고에 보관하고 ‘현재 금고 노트 열기’에서 확인하세요. 금고에서 노트를 해제하면 이 버전들도 일반 버전으로 돌아옵니다.")}</p>
          <ul>{sealed.map(v=><li key={v.id}>{t("보관: {name}",{name:v.label})} · {formatDateTime(v.created_at)}</li>)}</ul>
          <button type="button" className="btn btn-secondary" onClick={()=>{store.closeDialog();window.dispatchEvent(new CustomEvent("inkism-open-settings",{detail:"lock"}));}}>{t("금고 설정 열기")}</button>
        </section>
      )}
      {error && <p className="dialog-message danger-text">{error}</p>}
      {!error && entries === null && <p className="dialog-message">{t("기록을 불러오는 중…")}</p>}
      {entries !== null && entries.length === 0 && (
        <p className="dialog-message">
          {t("아직 저장된 버전이 없습니다. 노트를 편집하면 최대 20개까지 버전이 기록됩니다.")}
        </p>
      )}
      {entries !== null && entries.length > 0 && (
        <div className="history-compare">
          <ul className="history-list" aria-label={t("버전 목록")}>
            {entries.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  className={`history-item${h.id === selected ? " is-selected" : ""}`}
                  aria-current={h.id === selected ? "true" : undefined}
                  onClick={() => setSelected(h.id)}
                >
                  <span className="history-title">{h.label ? t("보관: {name}",{name:h.label}) : t("자동 버전")} · {formatDateTime(h.created_at)}</span>
                  <span className="history-date">{h.title || t("제목 없음")}</span>
                </button>
              </li>
            ))}
          </ul>
          <section className="history-diff" aria-label={t("이전 버전과 지금 노트 비교")}>
            <div className="history-diff-head">
              <span>
                <strong>{t("이전 버전")}</strong> {entry ? formatDateTime(entry.created_at) : ""}
              </span>
              <span>
                <strong>{t("지금 노트")}</strong>
                {diff && !("tooLarge" in diff) && (
                  <em className="history-diff-sum">
                    {t("추가 +{added}자 · 삭제 −{removed}자", { added: diff.added, removed: diff.removed })}
                  </em>
                )}
              </span>
            </div>
            {!compare && <p className="dialog-message">{t("비교하는 중…")}</p>}
            {compare && "error" in compare && <p className="dialog-message">{compare.error}</p>}
            {diff && "tooLarge" in diff && (
              <p className="dialog-message">
                {t("노트가 커서 문단 비교를 생략했어요. 복원이나 사본 저장은 할 수 있어요.")}
              </p>
            )}
            {diff && !("tooLarge" in diff) && (
              <div className="history-diff-rows">
                {diff.rows.length === 0 && <p className="dialog-message">{t("두 버전 모두 내용이 비어 있어요.")}</p>}
                {diff.rows.map((r, i) => (
                  <div key={i} className="diff-row">
                    <DiffCell text={r.left} kind={r.kind === "same" ? "same" : "del"} />
                    <DiffCell text={r.right} kind={r.kind === "same" ? "same" : "add"} />
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={() => store.closeDialog()}>
          {t("닫기")}
        </button>
        <button type="button" className="btn" disabled={!diff || copying} onClick={() => void saveCopy()}>
          {t("사본으로 저장")}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!entry}
          onClick={() => entry && void store.restoreVersion(entry.id)}
        >
          {t("이 버전으로 되돌리기")}
        </button>
      </div>
    </>
  );
}

/** 추가는 success-subtle + "+", 삭제는 danger-subtle + "−" + 취소선. 색만으로 구분하지 않는다. */
export function DiffCell({ text, kind }: Readonly<{ text: string | null; kind: "same" | "add" | "del" }>) {
  if (text === null) return <div className="diff-cell is-empty" aria-hidden />;
  if (kind === "same") return <div className="diff-cell">{text}</div>;
  return (
    <div className={`diff-cell is-${kind}`}>
      <span className="diff-mark" aria-label={kind === "add" ? t("추가") : t("삭제")}>
        {kind === "add" ? "+" : "−"}
      </span>
      {kind === "del" ? <del>{text}</del> : <ins>{text}</ins>}
    </div>
  );
}

/** 앱 안내·확인 창을 브라우저 최상위 층(top layer)에 띄운다. 설정 창처럼 이미 열린 모달 <dialog> 위에서도
 *  가려지지 않고 눌리게 한다. Esc는 위의 keydown 처리기가 맡으므로 기본 닫기는 막는다. */
function TopLayer({ children }: Readonly<{ children: React.ReactNode }>) {
  const ref = React.useRef<HTMLDialogElement>(null);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (el && !el.open) {
      try {
        el.showModal();
      } catch {
        el.setAttribute("open", "");
      }
    }
    return () => {
      if (el?.open) el.close();
    };
  }, []);
  return (
    <dialog ref={ref} className="dialog-layer" onCancel={(e) => e.preventDefault()}>
      {children}
    </dialog>
  );
}
