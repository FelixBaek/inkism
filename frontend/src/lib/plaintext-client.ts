/** plaintext 워커 래퍼. 대용량 원문 저장 시 메인 스레드 대신 텍스트를 추출한다. */
import StripWorker from "../workers/plaintext.worker?worker";
import { t } from "../i18n";
import { workerErrorMessage, type WorkerFailure } from "./error-messages";

let worker: Worker | null = null;
let sequence = 0;
const DEFAULT_TIMEOUT_MS = 8000;
const pending = new Map<
  number,
  { resolve: (text: string) => void; reject: (error: unknown) => void; timer: ReturnType<typeof setTimeout> }
>();

function takePending(id: number) {
  const request = pending.get(id);
  if (request) {
    clearTimeout(request.timer);
    pending.delete(id);
  }
  return request;
}

function failWorker(failed: Worker, error: unknown) {
  if (worker !== failed) return;
  worker = null;
  failed.onmessage = failed.onerror = failed.onmessageerror = null;
  failed.terminate();
  for (const id of pending.keys()) takePending(id)?.reject(error);
}

function ensureWorker(): Worker {
  if (!worker) {
    const created = new StripWorker();
    worker = created;
    created.onerror = (event) => {
      failWorker(created, event.error ?? new Error(event.message || t("알 수 없는 오류")));
    };
    created.onmessageerror = () => failWorker(created, new Error(t("알 수 없는 오류")));
    created.onmessage = (event: MessageEvent<{ id: number; text: string } & WorkerFailure>) => {
      const request = takePending(event.data.id);
      if (!request) return;
      if (event.data.error || event.data.error_code) request.reject(new Error(workerErrorMessage(event.data)));
      else request.resolve(event.data.text);
    };
  }
  return worker;
}

export function deriveTextInWorker(html: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  const activeWorker = ensureWorker();
  const id = ++sequence;
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      takePending(id)?.reject(new Error(t("검색용 텍스트 추출 시간이 초과되었습니다. 다시 저장해 주세요.")));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    try {
      activeWorker.postMessage({ id, html });
    } catch (error) {
      takePending(id)?.reject(error);
    }
  });
}
