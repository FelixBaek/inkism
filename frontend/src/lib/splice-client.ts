import SpliceWorker from "../workers/splice.worker?worker";
import type { BodySplice } from "./body-splice";
import { t } from "../i18n";
import { workerErrorMessage, type WorkerFailure } from "./error-messages";
export interface BodyChanges {
  content: BodySplice;
  text: BodySplice;
}
let worker: Worker | null = null;
let sequence = 0;
const pending = new Map<
  number,
  { resolve: (value: BodyChanges) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
>();
function fail() {
  worker?.terminate();
  worker = null;
  for (const item of pending.values()) {
    clearTimeout(item.timer);
    item.reject(new Error(t("변경 구간을 계산하지 못했습니다. 다시 저장해 주세요.")));
  }
  pending.clear();
}
export function deriveSplices(
  before: { content: string; text: string },
  after: { content: string; text: string },
): Promise<BodyChanges> {
  if (!worker) {
    worker = new SpliceWorker();
    worker.onerror = fail;
    worker.onmessageerror = fail;
    worker.onmessage = (event: MessageEvent<BodyChanges & { id: number } & WorkerFailure>) => {
      const item = pending.get(event.data.id);
      if (!item) return;
      clearTimeout(item.timer);
      pending.delete(event.data.id);
      if (event.data.error || event.data.error_code) item.reject(new Error(workerErrorMessage(event.data)));
      else item.resolve({ content: event.data.content, text: event.data.text });
    };
  }
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, timer: setTimeout(fail, 15000) });
    try {
      worker!.postMessage({ id, before, after });
    } catch {
      fail();
    }
  });
}
