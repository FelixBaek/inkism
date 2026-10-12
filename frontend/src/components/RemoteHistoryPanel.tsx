import { useRef, useState } from "react";
import { rpc } from "../api";
import { useStore } from "../store";
import { t } from "../i18n";

type Version = { seq: number; record_id: string; title: string; created_at: number; device_id: string; content_format: string };
export function RemoteHistoryPanel({ noteId }: { noteId: string }) {
  const store = useStore();
  const [items, setItems] = useState<Version[]>([]);
  const [cursor, setCursor] = useState(0);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ version: Version; content: string } | null>(null);
  const guard = useRef(false);
  const run = async (action: () => Promise<void>) => {
    if (guard.current) return;
    guard.current = true; setBusy(true); setError("");
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { guard.current = false; setBusy(false); }
  };
  const load = () => run(async () => {
    const page = await rpc<{ items: Version[]; cursor: number; done: boolean }>("remote_history_list", { note_id: noteId, after: cursor });
    setItems(old => [...old, ...page.items.filter(v => !old.some(existing => existing.seq === v.seq))]);
    setCursor(page.cursor); setDone(page.done);
  });
  const inspect = (version: Version) => run(async () => {
    const data = await rpc<{ content: string }>("remote_history_preview", { note_id: noteId, seq: version.seq, record_id: version.record_id });
    setPreview({ version, content: data.content });
  });
  const restore = () => run(async () => {
    if (!preview) return;
    const restored = await rpc<{ id: string }>("remote_history_restore", { note_id: noteId, seq: preview.version.seq, record_id: preview.version.record_id, confirmed: true });
    store.closeDialog(); store.refreshList(); await store.selectNote(restored.id);
  });
  return <details className="remote-history"><summary>{t("서버 버전 기록")}</summary>
    <p>{t("동기화 서버에 전송된 버전을 조회합니다. 복원하면 첨부파일을 확인한 뒤 새 노트로 저장합니다.")}</p>
    <p>{t("서버 기록을 오래된 순서로 100개씩 검색합니다. 이 노트의 버전이 없는 구간은 다음 기록을 조회하세요. 잠긴 노트와 동기화 제외 노트는 조회하지 않습니다.")}</p>
    <button type="button" disabled={busy || done} onClick={load}>{busy ? t("불러오는 중…") : done ? t("서버 기록 조회 완료") : t("다음 서버 기록 조회")}</button>
    {error && <p role="alert" className="danger-text">{error}</p>}
    <ul>{items.map(v => <li key={v.seq}><button type="button" disabled={busy} onClick={() => inspect(v)}>{new Date(v.created_at).toLocaleString()} · {v.title} · {v.content_format}</button></li>)}</ul>
    {done && items.length === 0 && <p>{t("복원할 서버 버전이 없습니다.")}</p>}
    {preview && <div><label>{t("서버 버전 원문")}<textarea readOnly value={preview.content} rows={8} style={{ width: "100%", boxSizing: "border-box" }} /></label>
      <button type="button" disabled={busy} onClick={restore}>{t("첨부파일과 함께 새 노트로 복원")}</button>
    </div>}
  </details>;
}
