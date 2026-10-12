import { useEffect, useState } from "react";
import "./AppUpdate.css";
import { t } from "../i18n";

/** Go 셸의 /api/update/* 응답 (internal/appupdate.Status). */
export type UpdateStatus = {
  current: string;
  commit: string;
  available: boolean;
  checked_at?: string;
  error?: string;
  phase?: "downloading" | "verifying" | "restarting";
  latest?: { version: string; notes?: string; published_at?: string };
};

async function call(path: string, post = false): Promise<UpdateStatus> {
  const res = await fetch(
    path,
    post ? { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" } : undefined,
  );
  const body = (await res.json().catch(() => null)) as { ok?: boolean; data?: UpdateStatus; error?: string } | null;
  if (!res.ok || !body?.ok || !body.data)
    throw new Error(body?.error || t("업데이트 요청 실패 (HTTP {status})", { status: res.status }));
  return body.data;
}

const PHASE: Record<string, string> = {
  downloading: t("내려받는 중…"),
  verifying: t("확인 중…"),
  restarting: t("다시 시작합니다…"),
};

/** 앱 업데이트 상태. 시작 30초 뒤 한 번 조용히 확인한다(실패는 표시하지 않음). */
export function useAppUpdate() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState<"check" | "apply" | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    call("/api/update/status").then(setStatus, () => {});
    const timer = window.setTimeout(
      () =>
        call("/api/update/check", true).then(
          (s) => {
            if (!s.error) setStatus(s);
          },
          () => {},
        ),
      30_000,
    );
    return () => clearTimeout(timer);
  }, []);
  const check = async () => {
    setBusy("check");
    setError("");
    try {
      setStatus(await call("/api/update/check", true));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const apply = async () => {
    setBusy("apply");
    setError("");
    const poll = window.setInterval(() => call("/api/update/status").then(setStatus, () => {}), 400);
    try {
      setStatus(await call("/api/update/apply", true));
      // 창 닫기와 같은 길: 편집 저장 → /api/close → 셸이 엔진을 닫고 종료 → 도우미가 파일을 바꾸고 다시 연다.
      window.dispatchEvent(new Event("native-close-request"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    } finally {
      clearInterval(poll);
    }
  };
  return { status, busy, error, check, apply, available: !!status?.available };
}

export type AppUpdate = ReturnType<typeof useAppUpdate>;

/** "inkism 0.2.0 (abc1234)" */
export function versionLabel(s: UpdateStatus | null, fallback?: string) {
  if (!s) return fallback;
  const commit = s.commit ? " (" + s.commit.slice(0, 7) + ")" : "";
  return `inkism ${s.current}${commit}`;
}

/** 정보 › 업데이트 카드의 설명 문구와 상태(색은 상태에만). */
export function updateText(u: AppUpdate): { text: string; tone?: "error" | "new" } {
  const s = u.status;
  if (u.busy === "apply") return { text: PHASE[s?.phase ?? "downloading"] ?? PHASE.downloading };
  if (u.busy === "check") return { text: t("확인하는 중…") };
  const error = u.error || s?.error;
  if (error) return { text: error, tone: "error" };
  if (s?.available && s.latest) {
    const notes = s.latest.notes ? " — " + s.latest.notes : "";
    return { text: t("새 버전 {version}", { version: s.latest.version }) + notes, tone: "new" };
  }
  if (s?.checked_at) return { text: t("최신 버전입니다.") };
  return { text: t("새 버전이 있는지 확인합니다.") };
}
