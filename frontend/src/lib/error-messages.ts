import { t } from "../i18n";

// These prefixes are the EngineError/RuntimeError string-envelope contract.
// Keep classification separate from the translated text used by the UI.
const prefixes = {
  "conflict": (error: string) => t("충돌: {error}", { error }),
  "invalid": (error: string) => t("잘못된 요청: {error}", { error }),
  "not_found": (error: string) => t("찾을 수 없음: {error}", { error }),
  "internal": (error: string) => t("내부 오류: {error}", { error }),
  "storage engine": (error: string) => t("저장소 오류: {error}", { error }),
  "runtime config": (error: string) => t("앱 설정 오류: {error}", { error }),
  "sync": (error: string) => t("동기화 오류: {error}", { error }),
  "io": (error: string) => t("파일 오류: {error}", { error }),
};
type Prefix = keyof typeof prefixes;
const splitPrefix = (message: string): [Prefix, string] | null => {
  const at = message.indexOf(": ");
  const prefix = message.slice(0, at);
  return at > 0 && Object.hasOwn(prefixes, prefix) ? [prefix as Prefix, message.slice(at + 2)] : null;
};

export function backendErrorCode(message: string): string | undefined {
  let code: string | undefined;
  for (let depth = 0; depth < 8; depth++) {
    const part = splitPrefix(message);
    if (!part) break;
    code = part[0].replaceAll(" ", "_");
    if (["conflict", "invalid", "not_found", "internal"].includes(code)) break;
    message = part[1];
  }
  return code;
}

export function backendErrorDetail(message: string): string {
  for (let depth = 0; depth < 8; depth++) {
    const part = splitPrefix(message);
    if (!part) break;
    message = part[1];
    if (["conflict", "invalid", "not_found", "internal"].includes(part[0])) break;
  }
  return message;
}

function localizeDetail(message: string): string {
  switch (message) {
    case "document revision changed":
    case "note revision changed": return t("문서가 변경되었습니다. 다시 시도해 주세요.");
    case "version name changed": return t("버전 이름이 변경되었습니다. 목록을 다시 불러와 주세요.");
    case "note is not editable":
    case "note is no longer editable": return t("노트가 잠김·읽기 전용·휴지통 상태인지 확인해 주세요. 현재는 편집할 수 없습니다.");
    case "note was deleted": return t("노트가 삭제되었습니다.");
    case "source changed": return t("원문이 변경되었습니다. 다시 불러온 뒤 시도해 주세요.");
    case "note is locked": return t("잠긴 노트입니다. 금고를 연 뒤 다시 시도해 주세요.");
    case "note is not locked": return t("금고에 보관된 노트가 아닙니다.");
    case "vault note or versions changed": return t("금고 노트나 버전이 변경되었습니다. 다시 불러와 주세요.");
    case "named version":
    case "version not found": return t("이름 붙인 버전을 찾을 수 없습니다.");
    case "version name requires 1–120 characters": return t("버전 이름은 1~120자로 입력해 주세요.");
    case "sync is in progress; retry after it finishes": return t("동기화가 진행 중입니다. 완료한 뒤 다시 시도해 주세요.");
    case "sync is not configured": return t("동기화를 먼저 설정해 주세요.");
    case "authentication failed": return t("인증에 실패했습니다. 다시 로그인해 주세요.");
    case "note body exceeds read budget": return t("노트 본문이 조회 용량 제한을 초과했습니다. 구간별로 불러옵니다.");
    case "편집 기준 버전이 이력에 없습니다. 현재 편집을 유지했습니다.": return t("편집 기준 버전이 이력에 없습니다. 현재 편집을 유지했습니다.");
    case "읽기 전용 노트입니다. 읽기 전용을 해제한 뒤 편집하세요": return t("읽기 전용 노트입니다. 읽기 전용을 해제한 뒤 편집하세요");
    case "잠긴 노트입니다. 잠금을 연 편집기에서 저장하세요": return t("잠긴 노트입니다. 잠금을 연 편집기에서 저장하세요");
    case "금고 비밀번호가 맞지 않습니다": return t("금고 비밀번호가 맞지 않습니다");
    case "금고가 잠겨 있습니다. 먼저 잠금을 여세요": return t("금고가 잠겨 있습니다. 먼저 잠금을 여세요");
    case "금고가 이미 있습니다": return t("금고가 이미 있습니다");
    case "금고 키가 바뀌었습니다. 다시 시도하세요": return t("금고 키가 바뀌었습니다. 다시 시도하세요");
    case "잠긴 노트가 남아 있습니다. 먼저 모두 해제하세요": return t("잠긴 노트가 남아 있습니다. 먼저 모두 해제하세요");
    case "알림 캐시를 갱신하지 못했습니다. 다시 시도해 주세요": return t("알림 캐시를 갱신하지 못했습니다. 다시 시도해 주세요");
    case "표시 구간의 태그가 맞지 않습니다.": return t("표시 구간의 태그가 맞지 않습니다.");
    case "잘못된 원문 경계입니다.": return t("잘못된 원문 경계입니다.");
    case "원문 토큰 내부에서 줄 경계를 자를 수 없습니다.": return t("원문 토큰 내부에서 줄 경계를 자를 수 없습니다.");
    case "큰 서식 토큰의 표시 범위를 준비하지 못했습니다. 원문을 유지합니다.": return t("큰 서식 토큰의 표시 범위를 준비하지 못했습니다. 원문을 유지합니다.");
    case "원문 줄 경계가 표시 구간을 벗어났습니다.": return t("원문 줄 경계가 표시 구간을 벗어났습니다.");
    case "잘못된 표시 줄 범위입니다.": return t("잘못된 표시 줄 범위입니다.");
    case "표시 줄의 원문을 찾지 못했습니다.": return t("표시 줄의 원문을 찾지 못했습니다.");
  }
  const revision = /^note ([\w-]+) revision (-?\d+) != current (-?\d+)$/.exec(message);
  if (revision) return t("노트 {id}의 버전이 바뀌었습니다 (요청 {expected}, 현재 {current}). 다시 불러와 주세요.", {id: revision[1], expected: revision[2], current: revision[3]});
  const note = /^note ([\w-]+)$/.exec(message);
  if (note) return t("노트를 찾을 수 없습니다: {id}", {id: note[1]});
  const duplicate = /^duplicate block ID (.+): rename the duplicate block ID before merging$/.exec(message);
  if (duplicate) return t("중복 문단 ID {id}: 병합 전에 ID를 바꿔 주세요.", {id: duplicate[1]});
  // Exact keys already in the app's dictionaries can come from the backend
  // too. Unknown diagnostics, identifiers and paths remain intact.
  return t(message);
}

export function localizeBackendError(message: string, depth = 0): string {
  const part = depth < 8 ? splitPrefix(message) : null;
  return part ? prefixes[part[0]](localizeBackendError(part[1], depth + 1)) : localizeDetail(message);
}

export type WorkerErrorCode = "plaintext_extract_failed" | "splice_compute_failed" | "source_scan_failed";
export interface WorkerFailure { error?: string; error_code?: WorkerErrorCode; }
export function workerErrorMessage(failure: WorkerFailure): string {
  let summary: string | undefined;
  switch (failure.error_code) {
    case "plaintext_extract_failed": summary = t("검색용 텍스트를 추출하지 못했습니다."); break;
    case "splice_compute_failed": summary = t("변경 구간을 계산하지 못했습니다."); break;
    case "source_scan_failed": summary = t("문서 구간을 계산하지 못했습니다."); break;
  }
  const detail = failure.error ? localizeBackendError(failure.error) : "";
  return summary && detail && summary !== detail ? `${summary}\n${detail}` : summary || detail || t("알 수 없는 오류");
}
