import { lang, t } from "../i18n";
import { useEffect, useReducer, useRef, useState } from "react";
import { RefreshCw, CloudCheck, AlertTriangle, LockKeyhole } from "../icons";
import { formatRelative } from "../lib/date";
import { rpc } from "../api";
import { useStore } from "../store";
type Status = {
  configured: boolean;
  paused: boolean;
  running: boolean;
  pending: number;
  last_sync: number | null;
  error: string | null;
  /** 이 기기의 금고 열기를 기다리는 노트 id. 오류가 아니며 금고를 열면 적용된다. */
  vault_key_required?: string[];
  /** 더 새 버전 앱이 만든 변경 수. 보관 중이며 앱을 업데이트하면 적용된다. */
  unsupported_records?: number;
  server_url?: string;
  scope?: { notebook_ids?: string[]; tags?: string[] };
};
type Storage = { encrypted: boolean };

/** 설정 창의 다른 화면(금고·정보)으로 이동한다. */
function openSettingsSection(section: "lock" | "about") {
  window.dispatchEvent(new CustomEvent("inkism-open-settings", { detail: section }));
}

/** 금고 키 대기·새 버전 변경 보관 안내. 다른 노트의 동기화는 그대로 계속된다. */
function SyncHeldNotices({ status }: Readonly<{ status: Status }>) {
  const waiting = status.vault_key_required ?? [];
  const newer = status.unsupported_records ?? 0;
  const [titles, setTitles] = useState<Record<string, string>>({});
  const key = waiting.join("\n");
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    const names: Record<string, string> = {};
    let next = 0;
    // Titles only: bounded previews, at most four requests, and no new work
    // after the dialog closes or the waiting list changes.
    const readTitles = async () => {
      while (alive && next < waiting.length) {
        const id = waiting[next++];
        try {
          const note = await rpc<{ title: string }>("note_preview", { id }, { signal: controller.signal });
          names[id] = note.title || t("제목 없음");
        } catch {
          if (!alive) return;
          names[id] = id;
        }
        if (alive) setTitles({ ...names });
      }
    };
    setTitles({});
    void Promise.all(Array.from({ length: Math.min(4, waiting.length) }, readTitles));
    return () => {
      alive = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!waiting.length && !newer) return null;
  return (
    <>
      {waiting.length > 0 && (
        <section className="sync-held" aria-live="polite" aria-label={t("금고 열기를 기다리는 변경")}>
          <strong>
            <LockKeyhole size={14} aria-hidden /> {t("금고 열기를 기다리는 노트 {n}개", { n: waiting.length })}
          </strong>
          <p className="sync-hint">
            {t(
              "다른 기기에서 금고에 보관한 노트와 이 기기에서 만든 버전이 겹쳤습니다. 이 기기에서 금고를 열면 버전을 암호화해 적용합니다. 변경은 지워지지 않고 보관되며, 다른 노트는 계속 동기화됩니다.",
            )}
          </p>
          <ul className="sync-held-list">
            {waiting.map((id) => (
              <li key={id}>{titles[id] ?? id}</li>
            ))}
          </ul>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              openSettingsSection("lock");
            }}
          >
            {t("금고 열기")}
          </button>
        </section>
      )}
      {newer > 0 && (
        <section className="sync-held" aria-live="polite" aria-label={t("새 버전 앱의 변경")}>
          <strong>{t("새 버전 앱에서 만든 변경 {n}개 보관 중", { n: newer })}</strong>
          <p className="sync-hint">
            {t(
              "다른 기기의 더 새로운 앱이 만든 변경이라 이 버전에서는 아직 적용할 수 없습니다. 지우지 않고 보관하며, 앱을 업데이트하면 적용됩니다. 다른 노트는 계속 동기화됩니다.",
            )}
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              openSettingsSection("about");
            }}
          >
            {t("업데이트 확인")}
          </button>
        </section>
      )}
    </>
  );
}

/** POSTs to a native storage endpoint and returns its data, throwing the server error. */
async function storageAction(path: string, failure: string) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || failure);
  return result.data;
}

function stateLabel(status: Status) {
  if (status.paused) return t("일시중지됨");
  if (status.running) return t("동기화 중…");
  return status.error ? t("연결 오류") : t("켜짐");
}

function dotClass(status: Status) {
  if (status.paused) return "connection-dot off";
  return status.error ? "connection-dot bad" : "connection-dot";
}

function submitLabel(busy: boolean, editing: boolean) {
  if (busy) return t("연결 중…");
  return editing ? t("바꾸고 다시 연결") : t("동기화 연결");
}

function storageLine(storageError: boolean, storage: Storage | null) {
  if (storageError) return t("저장 보호 상태를 확인하지 못했습니다. 창을 다시 열어 주세요.");
  if (!storage) return t("저장 보호 상태 확인 중…");
  return storage.encrypted ? t("로컬 저장소가 암호화되어 있습니다.") : t("로컬 저장소가 암호화되어 있지 않습니다.");
}

function StorageDetails({
  storage,
  canCopy,
  disabled,
  copying,
  onCopy,
}: Readonly<{ storage: Storage; canCopy: boolean; disabled: boolean; copying: boolean; onCopy: () => void }>) {
  return (
    <>
      {storage.encrypted ? (
        <p className="sync-hint">
          {t("저장 키는 현재 Windows 계정으로 보호됩니다. 다른 PC로 옮길 때는 동기화나 내보내기를 쓰세요.")}
        </p>
      ) : (
        <>
          <p className="sync-hint">
            {t(
              "노트와 첨부파일을 새 암호화 폴더로 복사합니다. 원본은 그대로 유지되며, 복사 중에는 편집을 잠시 멈춥니다.",
            )}
          </p>
          {canCopy ? (
            <button type="button" className="btn btn-secondary" disabled={disabled} onClick={onCopy}>
              {copying ? t("저장 후 암호화 복사 중…") : t("암호화 사본 만들기")}
            </button>
          ) : (
            <p className="sync-hint">{t("Windows 앱에서 암호화 사본을 만들 수 있습니다.")}</p>
          )}
        </>
      )}
    </>
  );
}

/** part="sync": 동기화 연결·상태(설정 › 동기화), part="storage": 이 기기의 저장 보호(설정 › 백업과 복원). */
export function SyncSettings({ part = "sync" }: Readonly<{ part?: "sync" | "storage" }>) {
  const store = useStore();
  const [copying, setCopying] = useState(false);
  const [opening, setOpening] = useState(false);
  const working = copying || opening;
  const copyRunning = useRef(false);
  const [copyMessage, setCopyMessage] = useState("");
  // 설정 화면 안에 펼쳐 둔다: 보이는 동안이 곧 열린 상태.
  const open = part === "sync";
  const [status, setStatus] = useState<Status | null>(null);
  const [storage, setStorage] = useState<Storage | null>(null);
  const [storageError, setStorageError] = useState(false);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [key, setKey] = useState("");
  const [scopeNotebooks, setScopeNotebooks] = useState("");
  const [scopeTags, setScopeTags] = useState("");
  const scopeDirty = useRef(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const editingRef = useRef(false);
  editingRef.current = editing;
  useEffect(() => {
    // 복사·저장소 열기 중에는 설정 화면을 떠나지 않는다(예전 창의 Esc·닫기 막기와 같음).
    const leave = (e: Event) => (e as CustomEvent<Promise<boolean>[]>).detail.push(Promise.resolve(!copyRunning.current));
    window.addEventListener("inkism-settings-leave", leave);
    return () => window.removeEventListener("inkism-settings-leave", leave);
  }, []);
  useEffect(() => {
    if (!open || working) return;
    const update = () =>
      rpc<Status>("sync_status")
        .then((v) => {
          setStatus(v);
          if (!editingRef.current && !scopeDirty.current && v.scope) {
            setScopeNotebooks((v.scope.notebook_ids ?? []).join(", "));
            setScopeTags((v.scope.tags ?? []).join(", "));
          }
          if (v.server_url && !editingRef.current) setUrl(v.server_url);
        })
        .catch((e) => setError(e.message));
    void update();
    const timer = setInterval(update, 3000);
    return () => clearInterval(timer);
  }, [open, working]);
  useEffect(() => {
    if (part !== "storage") return;
    let active = true;
    setStorage(null);
    setStorageError(false);
    void rpc<Storage>("storage_status")
      .then((value) => {
        if (active) setStorage(value);
      })
      .catch(() => {
        if (active) setStorageError(true);
      });
    return () => {
      active = false;
    };
  }, [part]);
  const copyEncrypted = async () => {
    if (copyRunning.current) return;
    copyRunning.current = true;
    setCopying(true);
    setError("");
    setCopyMessage("");
    try {
      if (!(await store.flushNow()))
        throw new Error(t("작성 내용을 저장하지 못했습니다. 저장 오류를 해결한 뒤 다시 시도해 주세요."));
      const data = await storageAction("/api/storage/encrypted-copy", t("암호화 사본을 만들지 못했습니다."));
      setCopyMessage(
        data.cancelled
          ? t("폴더 선택을 취소했습니다.")
          : t("암호화 사본을 만들었습니다. 현재 앱은 원본을 계속 사용합니다. 사본 위치: {path}", { path: data.path }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : t("암호화 복사 결과를 확인하지 못했습니다."));
    } finally {
      copyRunning.current = false;
      setCopying(false);
    }
  };
  const openLibrary = async () => {
    if (copyRunning.current) return;
    copyRunning.current = true;
    setOpening(true);
    setError("");
    setCopyMessage("");
    try {
      if (!(await store.flushNow()))
        throw new Error(t("작성 내용을 저장하지 못했습니다. 저장 오류를 해결한 뒤 다시 시도해 주세요."));
      const data = await storageAction("/api/storage/open", t("저장소를 열지 못했습니다."));
      if (data.cancelled) setCopyMessage(t("저장소 선택을 취소했습니다."));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("저장소를 열지 못했습니다."));
    } finally {
      copyRunning.current = false;
      setOpening(false);
    }
  };
  const configure = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      // 연결 정보 바꾸기: 서버나 키가 달라지면 엔진이 새 동기화 상태로 다시 시작한다.
      await rpc("sync_config", { server_url: url.trim(), token: token.trim(), key: key.trim(), migration: editing });
      setToken("");
      setKey("");
      setEditing(false);
      await rpc("sync_now");
      setStatus(await rpc<Status>("sync_status"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const setPaused = async (paused: boolean) => {
    setBusy(true);
    setError("");
    try {
      await rpc("sync_pause", { paused });
      setStatus(await rpc<Status>("sync_status"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const saveScope = async () => {
    setBusy(true); setError("");
    try {
      const split = (value: string) => [...new Set(value.split(",").map(item => item.trim()).filter(Boolean))];
      await rpc("sync_scope", { scope: { notebook_ids: split(scopeNotebooks), tags: split(scopeTags) } });
      scopeDirty.current = false;
      setStatus(await rpc<Status>("sync_status"));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return (
    <>
      <div className={"sync-settings sync-settings--" + part}>
        <fieldset className="sync-fields" disabled={working}>
          {part === "sync" && (status?.configured && !editing ? (
            <section className="sync-card" aria-label={t("동기화 상태")}>
              <h3>{t("동기화 상태")}</h3>
              <p className="sync-state">
                <span className={dotClass(status)} aria-hidden />
                <output>{stateLabel(status)}</output>
              </p>
              <dl className="sync-rows">
                <dt>{t("서버")}</dt>
                <dd>{status.server_url}</dd>
                <dt>{t("최근 동기화")}</dt>
                <dd>{status.last_sync ? new Date(status.last_sync).toLocaleString(lang) : t("아직 없음")}</dd>
                <dt>{t("전송 대기")}</dt>
                <dd>{t("{n}개", { n: status.pending ?? 0 })}</dd>
              </dl>
              <div className="sync-actions">
                <button
                  className="btn btn-primary"
                  disabled={busy || status.running || status.paused}
                  onClick={() => void rpc("sync_now").catch((e) => setError(e.message))}
                >
                  {t("지금 동기화")}
                </button>
                <button
                  className="btn btn-secondary"
                  disabled={busy || status.running}
                  onClick={() => void setPaused(!status.paused)}
                >
                  {status.paused ? t("동기화 다시 시작") : t("동기화 일시중지")}
                </button>
                <button className="btn" disabled={busy || status.running} onClick={() => setEditing(true)}>
                  {t("연결 정보 바꾸기")}
                </button>
              </div>
              <section className="sync-scope" aria-label={t("동기화 범위")}>
                <strong>{t("동기화 범위")}</strong>
                <p className="sync-hint">{t("비워 두면 전체 노트를 동기화합니다. 둘 다 입력하면 폴더와 태그를 모두 만족하는 노트만 선택합니다.")}</p>
                <label>{t("폴더 ID")}
                  <input value={scopeNotebooks} onChange={e => { scopeDirty.current = true; setScopeNotebooks(e.target.value); }} placeholder="id1, id2" />
                </label>
                <label>{t("태그")}
                  <input value={scopeTags} onChange={e => { scopeDirty.current = true; setScopeTags(e.target.value); }} placeholder="work, urgent" />
                </label>
                <button type="button" className="btn" disabled={busy || status.running} onClick={() => void saveScope()}>{t("동기화 범위 저장")}</button>
              </section>
              <SyncHeldNotices status={status} />
              {status.paused && (
                <p className="sync-hint">{t("이 기기의 변경은 보관됩니다. 다시 시작하면 그때 보냅니다.")}</p>
              )}
            </section>
          ) : (
            <>
              {!status?.configured && (
                <section className="sync-card sync-guide" aria-label={t("동기화 안내")}>
                  <h3>{t("동기화 안내")}</h3>
                  <p className="sync-state">
                    <span className="connection-dot off" aria-hidden />
                    <output>{t("꺼져 있음 — 노트는 이 기기에만 저장됩니다.")}</output>
                  </p>
                  <ol className="sync-steps">
                    <li>
                      <b>{t("서버 준비")}</b>{" "}
                      {t(
                        "직접 운영하는 동기화 서버의 주소와 접속 토큰이 필요합니다. 만드는 방법은 README의 ‘동기화 중계 서버’에 있습니다.",
                      )}
                    </li>
                    <li>
                      <b>{t("첫 기기")}</b>{" "}
                      {t("주소·토큰을 넣고 ‘첫 기기용 키 만들기’를 누른 뒤 키를 따로 보관하세요.")}
                    </li>
                    <li>
                      <b>{t("다른 기기")}</b> {t("같은 주소·토큰·키를 넣으면 노트가 맞춰집니다.")}
                    </li>
                  </ol>
                  <p className="sync-hint">{t("노트는 기기에서 암호화한 뒤 보내므로 서버는 내용을 볼 수 없습니다.")}</p>
                </section>
              )}
              <form className="sync-card" onSubmit={configure} aria-label={t("연결 설정")}>
                <h3>{t("연결 설정")}</h3>
                {editing && (
                  <p className="sync-hint">
                    {t(
                      "서버나 키를 바꾸면 이 기기의 노트를 새 곳으로 처음부터 다시 보냅니다. 토큰만 바꿀 때는 기존 키를 그대로 넣으세요.",
                    )}
                  </p>
                )}
                <label>
                  {t("서버 주소")}
                  <input
                    type="url"
                    required
                    placeholder="https://"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                </label>
                <label>
                  {t("접속 토큰")}
                  <input
                    type="password"
                    required
                    autoComplete="off"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                  />
                </label>
                <label>
                  {t("암호화 키")}
                  <input
                    type="password"
                    required
                    autoComplete="off"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                  />
                </label>
                <div className="sync-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      void rpc<{ key: string }>("sync_keygen")
                        .then((v) => setKey(v.key))
                        .catch((e) => setError(e.message))
                    }
                  >
                    {t("첫 기기용 키 만들기")}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={!key}
                    onClick={() =>
                      void navigator.clipboard.writeText(key).catch(() => setError(t("키를 복사할 수 없습니다")))
                    }
                  >
                    {t("키 복사")}
                  </button>
                </div>
                <p className="sync-hint">
                  {t("서버는 키를 보관하지 않습니다. 키를 잃으면 다른 기기를 연결할 수 없습니다.")}
                </p>
                <div className="sync-actions">
                  <button type="submit" className="btn btn-primary" disabled={busy}>
                    {submitLabel(busy, editing)}
                  </button>
                  {editing && (
                    <button type="button" className="btn" disabled={busy} onClick={() => setEditing(false)}>
                      {t("취소")}
                    </button>
                  )}
                </div>
              </form>
            </>
          ))}
          {part === "storage" && <section className="sync-card" aria-labelledby="storage-title">
            <h3 id="storage-title">{t("이 기기의 저장 보호")}</h3>
            <p>
              <output>{storageLine(storageError, storage)}</output>
            </p>
            {storage && (
              <StorageDetails
                storage={storage}
                canCopy={Boolean(store.info?.native_encrypted_copy)}
                disabled={busy || working}
                copying={copying}
                onCopy={() => void copyEncrypted()}
              />
            )}
            {store.info?.native_open_library && (
              <>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy || working}
                  onClick={() => void openLibrary()}
                >
                  {opening ? t("저장 후 저장소 여는 중…") : t("다른 저장소 열기")}
                </button>
                <p className="sync-hint">{t("고른 저장소로 앱을 다시 열고, 다음에도 그 저장소를 씁니다.")}</p>
              </>
            )}
          </section>}
        </fieldset>
        {opening && (
          <p>
            <output>{t("열 저장소 파일을 선택해 주세요.")}</output>
          </p>
        )}
        {copying && (
          <p>
            <output>{t("폴더를 선택하면 복사를 시작합니다. 완료될 때까지 기다려 주세요.")}</output>
          </p>
        )}
        {copyMessage && (
          <p>
            <output>{copyMessage}</output>
          </p>
        )}
        {(error || status?.error) && (
          <p role="alert" className="sync-error">
            {error || status?.error}
          </p>
        )}
      </div>
    </>
  );
}

function connectionLabel(failed: boolean, connected: boolean) {
  if (failed) return t("연결 실패");
  return connected ? t("연결됨") : t("연결 중…");
}

type SyncState = "error" | "paused" | "running" | "vault" | "newer" | "pending" | "ok";

function syncState(status: Status): SyncState {
  if (status.error) return "error";
  if (status.paused) return "paused";
  if (status.running) return "running";
  if (status.vault_key_required?.length) return "vault";
  if (status.unsupported_records) return "newer";
  return status.pending > 0 ? "pending" : "ok";
}

const STATE_ICONS = {
  error: AlertTriangle,
  paused: RefreshCw,
  running: RefreshCw,
  vault: LockKeyhole,
  newer: AlertTriangle,
  pending: RefreshCw,
  ok: CloudCheck,
};

/** 하단 연결·동기화 상태. 동기화가 설정되어 있으면 눌러서 지금 동기화한다. */
export function SyncIndicator() {
  const store = useStore();
  const [status, setStatus] = useState<Status | null>(null);
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    let alive = true;
    const update = () => {
      if (document.visibilityState === "visible")
        rpc<Status>("sync_status")
          .then((v) => {
            if (alive) setStatus(v);
          })
          .catch(() => {
            if (alive) setStatus(null);
          });
      tick();
    };
    update();
    const timer = setInterval(update, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  if (store.connError || !status?.configured)
    return (
      <output className="status-connection">
        <span className={store.connError ? "connection-dot bad" : "connection-dot"} />
        {connectionLabel(Boolean(store.connError), Boolean(store.info))}
      </output>
    );
  const state = syncState(status);
  const text = {
    error: t("동기화 오류"),
    paused: t("동기화 일시중지됨"),
    running: t("동기화 중…"),
    vault: t("금고 열기 대기 {n}개", { n: status.vault_key_required?.length ?? 0 }),
    newer: t("업데이트 필요한 변경 {n}개", { n: status.unsupported_records ?? 0 }),
    pending: t("전송 대기 {n}개", { n: status.pending ?? 0 }),
    ok: status.last_sync ? t("연결됨") : t("동기화 대기"),
  }[state];
  const Icon = STATE_ICONS[state];
  let actionLabel = t("{status} — 지금 동기화", { status: text });
  if (state === "vault") actionLabel = t("{status} — 금고 열기", { status: text });
  else if (state === "newer") actionLabel = t("{status} — 업데이트 확인", { status: text });
  return (
    <button
      type="button"
      className={`status-connection sync-indicator sync-indicator--${state}`}
      disabled={status.running || status.paused}
      title={
        status.error ??
        (state === "vault"
          ? t("이 기기에서 금고를 열면 기다리는 변경을 적용합니다. 다른 노트는 계속 동기화됩니다.")
          : undefined) ??
        (state === "newer" ? t("앱을 업데이트하면 보관 중인 변경을 적용합니다.") : undefined) ??
        (status.last_sync ? t("최근 동기화: {time}", { time: formatRelative(status.last_sync) }) : undefined)
      }
      aria-label={actionLabel}

      onClick={() =>
        state === "vault" || state === "newer"
          ? openSettingsSection(state === "vault" ? "lock" : "about")
          : void rpc("sync_now")
          .then(() => rpc<Status>("sync_status"))
          .then(setStatus)
          .catch(() => {})
      }
    >
      <span aria-hidden>
        {state === "ok" ? (
          <span className="connection-dot" />
        ) : (
          <Icon size={13} className={state === "running" ? "spin" : undefined} />
        )}
      </span>
      <output className="side-label">{text}</output>
    </button>
  );
}
