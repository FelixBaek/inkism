import { checkpointDraftRecovery, type RecoveryFile } from "./draft-recovery";
import { windowBodySplice, type BodySplice } from "./body-splice";
import { isLargeDocument, type Draft, type Note } from "../types";
import { t } from "../i18n";

type Send = <T>(op: string, args: object, options?: { signal?: AbortSignal }) => Promise<T>;
type Diff = (before: string, after: string) => Promise<BodySplice>;
interface Checkpoint {
  id: string;
  token: string;
  sequence: number;
  completion: Promise<void>;
}
interface Completion {
  confirmed: () => void;
  failed: (error: unknown) => void;
}
interface Entry extends Checkpoint, Completion {
  file: RecoveryFile;
  baseline?: Note;
  windowEdit?: NonNullable<Draft["windowEdit"]>;
  followers: Completion[];
}

/** One writer coalesces waiting checkpoints. Neither browser storage nor the
 * editor's input callback serializes or computes a whole-document difference. */
export class DraftJournal {
  private readonly pending = new Map<string, Entry>();
  private readonly accepted = new Map<string, { token: string; sequence: number }>();
  private running: Promise<void> | null = null;
  private flight: Entry | null = null;
  private sequence = 0;
  private closed = false;
  private request: AbortController | null = null;
  get stopped() {
    return this.closed;
  }
  constructor(
    private readonly send: Send,
    private readonly diff: Diff,
    private readonly timeoutMs = 5000,
    private readonly editor: "main" | "split" = "main",
  ) {}

  stage(draft: Draft, baseline: Note | null): Checkpoint {
    if (this.closed) throw new Error(t("편집 화면이 닫혔습니다."));
    let confirmed!: () => void, failed!: (error: unknown) => void;
    const completion = new Promise<void>((resolve, reject) => {
      confirmed = resolve;
      failed = reject;
    });
    void completion.catch(() => {});
    const checkpoint: Entry = {
      id: draft.id,
      token: crypto.randomUUID(),
      sequence: ++this.sequence,
      file: checkpointDraftRecovery(draft),
      baseline:
        baseline?.id === draft.id &&
        baseline.revision === draft.revision &&
        baseline.content_format === draft.content_format
          ? { ...baseline }
          : undefined,
      windowEdit: draft.windowEdit,
      completion,
      confirmed,
      failed,
      followers: [],
    };
    const previous = this.pending.get(draft.id);
    if (previous && previous !== this.flight) {
      checkpoint.followers.push({ confirmed: previous.confirmed, failed: previous.failed }, ...previous.followers);
      previous.followers = [];
    }
    this.pending.set(draft.id, checkpoint);
    return {
      id: checkpoint.id,
      token: checkpoint.token,
      sequence: checkpoint.sequence,
      completion: checkpoint.completion,
    };
  }

  /** Await this checkpoint (or a newer coalesced one), not an endlessly growing
   * stream of later input. A normal note save therefore cannot be starved. */
  persist(checkpoint: Checkpoint): Promise<void> {
    void this.flush().catch(() => {});
    return this.withDeadline(checkpoint.completion);
  }

  private withDeadline<T>(pending: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(t("자동 복구 보관 응답을 기다리는 시간이 초과됐습니다."))),
          this.timeoutMs,
        );
      }),
    ]).finally(() => clearTimeout(timer));
  }

  flush(): Promise<void> {
    if (this.running) return this.running;
    this.running = (async () => {
      while (!this.closed && this.pending.size) {
        const checkpoint = this.pending.values().next().value!;
        this.flight = checkpoint;
        const { file, baseline } = checkpoint;
        let draft = file;
        if (file.body.kind === "complete" && file.body.revision > 0 && baseline && isLargeDocument(file.body.content)) {
          const edit =
            windowBodySplice(baseline, checkpoint.windowEdit) ?? (await this.diff(baseline.content, file.body.content));
          draft = {
            ...file,
            body: {
              kind: "partial",
              revision: file.body.revision,
              offset_encoding: "utf-8",
              edit_order: "sequential",
              edits: edit.expected === edit.replacement ? [] : [edit],
            },
          };
        }
        if (this.closed) throw new Error(t("편집 화면이 닫혔습니다."));
        this.request = new AbortController();
        await this.send(
          "draft_journal_put",
          { token: checkpoint.token, draft, editor: this.editor },
          { signal: this.request.signal },
        );
        this.request = null;
        this.accepted.set(checkpoint.id, { token: checkpoint.token, sequence: checkpoint.sequence });
        checkpoint.confirmed();
        for (const follower of checkpoint.followers) follower.confirmed();
        // Input can append a newer snapshot while this request is in flight.
        if (this.pending.get(checkpoint.id) === checkpoint) this.pending.delete(checkpoint.id);
      }
    })()
      .catch((error) => {
        this.flight?.failed(error);
        for (const follower of this.flight?.followers ?? []) follower.failed(error);
        for (const waiting of this.pending.values()) {
          waiting.failed(error);
          for (const follower of waiting.followers) follower.failed(error);
        }
        throw error;
      })
      .finally(() => {
        this.running = null;
        this.flight = null;
        this.request = null;
      });
    return this.running;
  }

  async clear(checkpoint: Checkpoint) {
    const queued = this.pending.get(checkpoint.id),
      written = this.accepted.get(checkpoint.id),
      flight = this.flight;
    // A normally saved checkpoint waiting behind a stalled request no longer
    // needs to retain its body in memory or be written after the save.
    if (queued && queued.sequence <= checkpoint.sequence && queued !== flight) {
      this.pending.delete(checkpoint.id);
      queued.confirmed();
      for (const follower of queued.followers) follower.confirmed();
    }
    if (flight?.id === checkpoint.id && flight.sequence < checkpoint.sequence) {
      const token = flight.token,
        id = flight.id;
      void flight.completion
        .then(() => {
          if (!this.closed) return this.clearToken(id, token);
        })
        .catch(() => {});
    }
    await this.clearToken(checkpoint.id, checkpoint.token);
    if (written && written.sequence < checkpoint.sequence) await this.clearToken(checkpoint.id, written.token);
  }

  private async clearToken(id: string, token: string) {
    await this.withDeadline(this.send("draft_journal_clear", { id, token, editor: this.editor }));
    if (this.accepted.get(id)?.token === token) this.accepted.delete(id);
  }

  /** Unmount aborts the old renderer's transport and forgets only RAM. The
   * durable journal remains available for engine recovery after a crash. */
  stop() {
    this.closed = true;
    this.request?.abort();
    const error = new Error(t("편집 화면이 닫혔습니다."));
    for (const entry of this.pending.values()) {
      entry.failed(error);
      for (const follower of entry.followers) follower.failed(error);
    }
    this.pending.clear();
  }

  /** Explicitly choosing the server version discards only tokens known now.
   * New input arriving during this wait keeps its own checkpoint. */
  async discard(id: string) {
    const tokens = new Set(
      [
        this.accepted.get(id)?.token,
        this.pending.get(id)?.token,
        this.flight?.id === id ? this.flight.token : undefined,
      ].filter((value): value is string => Boolean(value)),
    );
    const discarded = this.pending.get(id);
    if (discarded && discarded !== this.flight) {
      discarded.confirmed();
      for (const follower of discarded.followers) follower.confirmed();
    }
    this.pending.delete(id);
    try {
      await this.flight?.completion;
    } catch {
      /* The captured tokens remain safe to clear. */
    }
    for (const token of tokens) await this.clearToken(id, token);
  }
}
