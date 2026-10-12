import RangeWorker from "../workers/block-range.worker?worker";
import { t } from "../i18n";
export function locateBlockRange(
  source: string,
  start: number,
  expected: string,
): Promise<{ from: number; to: number }> {
  return new Promise((resolve, reject) => {
    const worker = new RangeWorker();
    const finish = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    const fail = () => {
      finish();
      reject(new Error(t("문서 구간을 확인하지 못했습니다. 다시 시도해 주세요.")));
    };
    const timer = setTimeout(fail, 15000);
    worker.onerror = fail;
    worker.onmessageerror = fail;
    worker.onmessage = (event) => {
      finish();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve({ from: event.data.from, to: event.data.to });
    };
    try {
      worker.postMessage({ source, start, expected });
    } catch {
      fail();
    }
  });
}
