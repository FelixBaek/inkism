import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { LockKeyhole } from "../icons";
import { securityRequest, type SecurityStatus } from "../lib/app-security";
import { useStore } from "../store";
import { flushWorkspaceForClose } from "../lib/workspace";
import "./AppSecurity.css";
import { WindowControls } from "./WindowControls";
import { t } from "../i18n";
type SecurityValue = {
  status: SecurityStatus;
  error: string;
  message: string;
  busy: boolean;
  lock: () => Promise<void>;
  login: () => Promise<SecurityStatus | null>;
  cancel: () => Promise<void>;
};
const SecurityContext = createContext<SecurityValue | null>(null);
function SetupNotice() {
  return (
    <div className="security-notice">
      <strong>{t("Google 로그인 설정이 필요합니다.")}</strong>
      <p>
        {t(
          "Google OAuth 데스크톱 클라이언트 ID를 준비하고 %APPDATA%\\Inkism\\google-client.json 파일의 client_id에 설정한 뒤 앱을 다시 열어 주세요. 현재는 Google 로그인을 시작할 수 없습니다.",
        )}
      </p>
    </div>
  );
}
function Limits() {
  return (
    <p className="security-limit">
      {t(
        "Google 로그인은 이 기기의 앱 잠금을 확인하는 용도입니다. 노트와 기존 Windows 보호 키는 그대로 유지됩니다. Google 계정으로 분실한 저장 키를 복구할 수 없으며, 잠긴 앱을 열려면 인터넷 연결이 필요합니다.",
      )}
    </p>
  );
}
function GoogleUnlockAction({
  status,
  pending,
  onLogin,
}: Readonly<{ status: SecurityStatus; pending: boolean; onLogin: () => void }>) {
  if (!status.configured && !status.pending)
    return (
      <p role="alert">
        {t(
          "Google 계정 연결을 완료하지 못했습니다. 기존 키나 계정 설정 파일을 삭제하지 말고 앱 설정 폴더의 저장 상태를 확인한 뒤 앱을 다시 열어 주세요.",
        )}
      </p>
    );
  if (status.setup_required || !status.available)
    return (
      <>
        <SetupNotice />
        <p>
          {t(
            "기존 키나 계정 설정 파일을 삭제하지 마세요. 설정을 확인한 뒤에도 열리지 않으면 기존 파일을 보존한 상태로 복구 지원을 요청해 주세요.",
          )}
        </p>
      </>
    );
  if (!status.configured) return null;
  return (
    <button type="button" className="btn btn-primary" disabled={pending} onClick={onLogin}>
      {t("Google로 잠금 해제")}
    </button>
  );
}
export function SecurityBoundary({ children }: Readonly<{ children: React.ReactNode }>) {
  const [status, setStatus] = useState<SecurityStatus | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [attempt, setAttempt] = useState(0),
    [busy, setBusy] = useState(false);
  const active = useRef(false),
    generation = useRef(0),
    loginRequest = useRef<AbortController | null>(null),
    canceling = useRef(false),
    locking = useRef(false);
  const refresh = useCallback(async () => {
    try {
      const value = await securityRequest("status");
      setStatus(value);
      return value;
    } catch (e) {
      setStatus(null);
      setError(e instanceof Error ? e.message : t("앱 잠금 상태를 확인하지 못했습니다."));
      return null;
    }
  }, []);
  useEffect(() => {
    let current = true;
    setError("");
    void securityRequest("status")
      .then((v) => {
        if (current) setStatus(v);
      })
      .catch((e) => {
        if (current) {
          setStatus(null);
          setError(e instanceof Error ? e.message : t("앱 잠금 상태를 확인하지 못했습니다."));
        }
      });
    return () => {
      current = false;
    };
  }, [attempt]);
  useEffect(
    () => () => {
      generation.current++;
      loginRequest.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (!busy && !status?.pending) return;
    let current = true,
      running = false;
    const timer = setInterval(() => {
      if (running) return;
      running = true;
      void securityRequest("status")
        .then((v) => {
          if (current) setStatus(v);
        })
        .catch((e) => {
          if (current) {
            setStatus(null);
            setError(e instanceof Error ? e.message : t("로그인 상태를 확인하지 못했습니다."));
          }
        })
        .finally(() => {
          running = false;
        });
    }, 1000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [busy, status?.pending]);
  const login = useCallback(async () => {
    if (active.current || status?.pending || !status?.available || status.setup_required) return null;
    active.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    const ticket = ++generation.current,
      controller = new AbortController();
    loginRequest.current = controller;
    try {
      const value = await securityRequest("login", controller.signal);
      if (ticket !== generation.current) return null;
      setStatus(value);
      if (value.configured && !value.locked) setMessage(t("Google 로그인 확인을 마쳤습니다."));
      return value;
    } catch (e) {
      if (ticket === generation.current) {
        setError(e instanceof Error ? e.message : t("Google 로그인을 완료하지 못했습니다."));
        await refresh();
      }
      return null;
    } finally {
      if (ticket === generation.current) {
        active.current = false;
        setBusy(false);
        loginRequest.current = null;
      }
    }
  }, [status, refresh]);
  const cancel = useCallback(async () => {
    if (canceling.current) return;
    canceling.current = true;
    try {
      const value = await securityRequest("cancel");
      generation.current++;
      loginRequest.current?.abort();
      loginRequest.current = null;
      active.current = false;
      setBusy(false);
      setStatus(value);
      setError("");
      setMessage(t("Google 로그인을 취소했습니다."));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("로그인을 취소하지 못했습니다. 다시 시도해 주세요."));
    } finally {
      canceling.current = false;
    }
  }, []);
  const lock = useCallback(async () => {
    if (locking.current) return;
    locking.current = true;
    try {
      let value: SecurityStatus;
      try {
        value = await securityRequest("lock");
      } catch (e) {
        try {
          value = await securityRequest("status");
        } catch {
          setStatus(null);
          setError(t("잠금 결과를 확인하지 못했습니다. 잠금 상태를 다시 확인해 주세요."));
          throw e;
        }
        if (!value.locked) throw e;
      }
      if (!value.locked) throw new Error(t("앱을 잠그지 못했습니다. 다시 시도해 주세요."));
      setStatus(value);
      window.location.reload();
    } finally {
      locking.current = false;
    }
  }, []);
  const pending = busy || Boolean(status?.pending);
  const contextValue = useMemo(
    () => (status ? { status, error, message, busy: pending, lock, login, cancel } : null),
    [status, error, message, pending, lock, login, cancel],
  );
  if (!status || status.locked)
    return (
      <div className="security-window">
        <header className="workspace-topbar security-titlebar" data-tauri-drag-region="deep">
          <strong>inkism</strong>
          <WindowControls />
        </header>
        <main className="security-screen" aria-label={t("앱 잠금")}>
          <div className="security-card">
            <LockKeyhole size={28} aria-hidden />
            <h1>inkism</h1>
            <p>
              <output>{status?.locked ? t("앱이 잠겨 있습니다.") : t("앱 잠금 상태를 확인하는 중…")}</output>
            </p>
            {status?.provider === "google" && (
              <>
                <p>
                  {t(
                    "이 Windows 사용자의 inkism 앱에 연결한 Google 계정으로 확인해 주세요. 별도의 앱 비밀번호는 사용하지 않습니다.",
                  )}
                </p>
                <GoogleUnlockAction status={status} pending={pending} onLogin={() => void login()} />
                <Limits />
              </>
            )}
            {pending && (
              <output style={{ display: "block" }}>
                <p>{t("기본 브라우저에서 Google 로그인을 완료해 주세요. 이 창은 확인 결과를 기다리고 있습니다.")}</p>
                <button type="button" className="btn" onClick={() => void cancel()}>
                  {t("Google 로그인 취소")}
                </button>
              </output>
            )}
            {message && (
              <p>
                <output>{message}</output>
              </p>
            )}
            {error && <p role="alert">{error}</p>}
            {(error || status?.locked) && (
              <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>
                {t("잠금 상태 다시 확인")}
              </button>
            )}
          </div>
        </main>
      </div>
    );
  return <SecurityContext.Provider value={contextValue}>{children}</SecurityContext.Provider>;
}
export function LockNowButton() {
  const security = useContext(SecurityContext),
    store = useStore(),
    running = useRef(false),
    dialog = useRef<HTMLDialogElement>(null);
  const [lockBusy, setLockBusy] = useState(false),
    [busy, setBusy] = useState(false),
    [consent, setConsent] = useState(false),
    [localError, setLocalError] = useState("");
  if (!security) return null;
  const lock = async () => {
    if (running.current) return;
    running.current = true;
    setLockBusy(true);
    try {
      if (!(await store.flushNow()))
        throw new Error(t("작성 내용을 저장하지 못해 잠그지 않았습니다. 저장 오류를 해결한 뒤 다시 시도해 주세요."));
      await flushWorkspaceForClose();
      await security.lock();
    } catch (e) {
      await store.showError(t("앱 잠금 실패"), e instanceof Error ? e.message : t("앱을 잠그지 못했습니다."));
    } finally {
      running.current = false;
      setLockBusy(false);
    }
  };
  const enroll = async () => {
    if (running.current || !consent) return;
    running.current = true;
    setBusy(true);
    setLocalError("");
    try {
      if (!(await store.flushNow())) throw new Error(t("작성 내용을 저장하지 못해 잠금 설정을 시작하지 않았습니다."));
      await flushWorkspaceForClose();
      const value = await security.login();
      if (value?.configured && !value.locked) dialog.current?.close();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e));
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  if (security.status.configured)
    return (
      <button type="button" className="side-item" disabled={lockBusy || security.busy} onClick={() => void lock()}>
        <LockKeyhole size={15} aria-hidden />
        <span>{lockBusy ? t("저장 후 잠그는 중…") : t("앱 잠그기")}</span>
      </button>
    );
  if (security.status.provider !== "google") return null;
  const pending = busy || security.busy,
    setup = security.status.setup_required || !security.status.available;
  return (
    <>
      <button
        type="button"
        className="side-item"
        onClick={() => {
          setConsent(false);
          setLocalError("");
          dialog.current?.showModal();
        }}
      >
        <LockKeyhole size={15} aria-hidden />
        <span>{t("Google 로그인 잠금 설정")}</span>
      </button>
      <dialog
        ref={dialog}
        className="dialog security-setup-dialog"
        aria-labelledby="google-lock-title"
        onCancel={(e) => {
          if (pending) e.preventDefault();
        }}
      >
        <h2 id="google-lock-title">{t("Google 로그인으로 앱 잠금")}</h2>
        {setup ? (
          <SetupNotice />
        ) : (
          <>
            <p>
              {t(
                "지금 Google 로그인이 성공하면 이 Windows 사용자의 inkism 앱에 해당 계정으로 로그인 잠금을 설정합니다. 이후 앱을 열거나 잠금을 해제할 때 같은 계정으로 확인합니다.",
              )}
            </p>
            <label className="security-consent">
              <input
                type="checkbox"
                checked={consent}
                disabled={pending}
                onChange={(e) => setConsent(e.target.checked)}
              />
              {t("Google 계정 연결과 이후 로그인 잠금 사용에 동의합니다.")}
            </label>
          </>
        )}
        <Limits />
        {pending && (
          <p>
            <output>{t("기본 브라우저에서 Google 로그인을 완료해 주세요. 확인 결과를 기다리고 있습니다.")}</output>
          </p>
        )}
        {(localError || security.error) && <p role="alert">{localError || security.error}</p>}
        {security.message && (
          <p>
            <output>{security.message}</output>
          </p>
        )}
        <div className="dialog-actions">
          {pending ? (
            <button type="button" className="btn" onClick={() => void security.cancel()}>
              {t("Google 로그인 취소")}
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => dialog.current?.close()}>
              {t("닫기")}
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={setup || !consent || pending}
            onClick={() => void enroll()}
          >
            {t("Google 로그인으로 잠금 설정")}
          </button>
        </div>
      </dialog>
    </>
  );
}
