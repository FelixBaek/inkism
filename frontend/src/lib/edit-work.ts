/** Consume the same immutable calculation in tests or in short UI batches. */
export type EditWorkStep = void | { runSync(): void; runAsync(check: () => void): Promise<void> };
export type EditWork<T> = Generator<EditWorkStep, T>;
export function finishEditWork<T>(work: EditWork<T>): T {
  let next = work.next();
  for (;;) {
    if (next.done) return next.value;
    try {
      const step = next.value as EditWorkStep;
      if (step) step.runSync();
    } catch (error) {
      next = work.throw(error);
      continue;
    }
    next = work.next();
  }
}
export async function scheduleEditWork<T>(work: EditWork<T>, check: () => void): Promise<T> {
  // Let queued input settle before taking the first expensive batch.
  await new Promise((resolve) => setTimeout(resolve, 0));
  let deadline = performance.now() + 8;
  let next: IteratorResult<EditWorkStep, T> | undefined;
  for (;;) {
    check();
    next ??= work.next();
    if (next.done) {
      check();
      return next.value;
    }
    try {
      const step = next.value as EditWorkStep;
      if (step) await step.runAsync(check);
      next = undefined;
    } catch (error) {
      // Cancellation must escape rather than enter an import fallback.
      check();
      next = work.throw(error);
    }
    check();
    if (performance.now() >= deadline) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      deadline = performance.now() + 8;
    }
  }
}
