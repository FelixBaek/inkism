import SourceScanWorker from "../workers/source-segments.worker?worker";
import type { SourceScanRequest, SourceSegmentSpan } from "../workers/source-segments.worker";
import type { DocumentSegment } from "../types";
import { t } from "../i18n";
import { workerErrorMessage, type WorkerFailure } from "./error-messages";

/** A task owns its worker: stale edits terminate it without delaying the next
 * edit. Return source offsets/context only; no DOM or full source comes back. */
export function scanSourceInWorker(request: SourceScanRequest, check: () => void): Promise<Iterable<DocumentSegment>> {
  return new Promise((resolve, reject) => {
    let worker: Worker | undefined,
      timer: ReturnType<typeof setTimeout> | undefined,
      poll: ReturnType<typeof setInterval> | undefined,
      done = false;
    const finish = () => {
      done = true;
      clearTimeout(timer);
      clearInterval(poll);
      worker?.terminate();
    };
    const fail = (error: unknown) => {
      if (done) return;
      finish();
      reject(error);
    };
    try {
      check();
      worker = new SourceScanWorker();
      timer = setTimeout(() => fail(new Error(t("문서 구간 계산이 지연되었습니다. 입력과 원문을 유지합니다."))), 15000);
      poll = setInterval(() => {
        try {
          check();
        } catch (error) {
          fail(error);
        }
      }, 8);
      worker.onerror = () => fail(new Error(t("문서 구간 계산을 시작하지 못했습니다. 입력과 원문을 유지합니다.")));
      worker.onmessageerror = () =>
        fail(new Error(t("문서 구간 계산 결과를 읽지 못했습니다. 입력과 원문을 유지합니다.")));
      worker.onmessage = (event: MessageEvent<{ spans?: SourceSegmentSpan[] } & WorkerFailure>) => {
        if (done) return;
        try {
          check();
          if (event.data.error || event.data.error_code) throw new Error(workerErrorMessage(event.data));
          const spans = event.data.spans;
          if (!Array.isArray(spans)) throw new Error(t("잘못된 문서 구간 계산 결과입니다."));
          let previous = 0;
          for (const span of spans) {
            if (
              !Number.isSafeInteger(span.from) ||
              !Number.isSafeInteger(span.to) ||
              span.from !== previous ||
              span.to <= span.from ||
              span.to > request.source.length
            )
              throw new Error(t("잘못된 문서 구간 계산 범위입니다."));
            previous = span.to;
          }
          if (request.untilByte === undefined && previous !== request.source.length)
            throw new Error(t("문서 구간 계산 결과가 누락되었습니다."));
          finish();
          resolve(
            (function* () {
              for (const span of spans)
                yield {
                  ordinal: span.ordinal,
                  byte_offset: span.byte_offset,
                  source: request.source.slice(span.from, span.to),
                  start_context: span.start_context,
                  end_context: span.end_context,
                };
            })(),
          );
        } catch (error) {
          fail(error);
        }
      };
      worker.postMessage(request);
    } catch (error) {
      fail(error);
    }
  });
}
