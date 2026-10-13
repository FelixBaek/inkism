import { t } from "../i18n";
export interface SecurityStatus {
  available: boolean;
  configured: boolean;
  locked: boolean;
  provider?: "google";
  setup_required?: boolean;
  pending?: boolean;
  /** 가린 계정(f***@example.com). 원래 주소는 엔진이 저장하지도 보내지도 않는다. */
  account_hint?: string;
}
export async function securityRequest(
  path: "status" | "lock" | "login" | "cancel" | "disable",
  signal?: AbortSignal,
): Promise<SecurityStatus> {
  const response = await fetch("/api/security/" + path, {
    method: path === "status" ? "GET" : "POST",
    cache: "no-store",
    signal,
    ...(path === "status" ? {} : { headers: { "Content-Type": "application/json" }, body: "{}" }),
  });
  let body: any;
  try {
    body = await response.json();
  } catch {
    throw new Error(t("앱 잠금 응답을 확인하지 못했습니다. 다시 시도해 주세요."));
  }
  if (!response.ok || body?.ok !== true)
    throw new Error(
      typeof body?.error === "string"
        ? body.error.slice(0, 300)
        : t("앱 잠금 요청을 처리하지 못했습니다. 다시 시도해 주세요."),
    );
  const v = body.data;
  if (
    !v ||
    typeof v.available !== "boolean" ||
    typeof v.configured !== "boolean" ||
    typeof v.locked !== "boolean" ||
    (v.provider !== undefined && v.provider !== "google") ||
    ["setup_required", "pending"].some((k) => v[k] !== undefined && typeof v[k] !== "boolean") ||
    (v.locked && !v.configured && v.provider !== "google") ||
    (v.provider === "google" && v.configured && (!v.available || v.setup_required) && !v.locked)
  )
    throw new Error(t("앱 잠금 상태 응답이 올바르지 않습니다."));
  // A configured profile with missing OAuth configuration must remain locked.
  return {
    available: v.available,
    configured: v.configured,
    locked: v.locked,
    ...(v.provider ? { provider: v.provider } : {}),
    ...(v.setup_required !== undefined ? { setup_required: v.setup_required } : {}),
    ...(v.pending !== undefined ? { pending: v.pending } : {}),
    ...(typeof v.account_hint === "string" && /^[^@\s*]\*\*\*@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(v.account_hint)
      ? { account_hint: v.account_hint }
      : {}),
  };
}
