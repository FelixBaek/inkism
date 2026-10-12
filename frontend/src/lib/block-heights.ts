/** Sparse Fenwick tree: unvisited blocks use an estimate, measured blocks use
 * their layout height. Pixel lookup descends the tree rather than repeatedly summing prefixes. */
export class BlockHeights {
  private count = 0;
  private readonly measured = new Map<number, number>();
  private readonly tree = new Map<number, number>();
  constructor(readonly estimate = 48) {}
  resize(count: number, invalidFrom = 0) {
    if (this.count === count) return;
    this.count = count;
    // Keep only measurements before the edited range; later ordinals moved.
    const keep = [...this.measured].filter(([index]) => index < invalidFrom && index < count);
    this.measured.clear();
    this.tree.clear();
    for (const [index, height] of keep) this.set(index, height);
  }
  clear() {
    this.measured.clear();
    this.tree.clear();
  }
  set(index: number, height: number) {
    if (index < 0 || index >= this.count || !Number.isFinite(height)) return false;
    height = Math.max(1, height);
    const old = this.measured.get(index) ?? this.estimate;
    if (Math.abs(old - height) < 0.25) return false;
    this.measured.set(index, height);
    for (let i = index + 1; i <= this.count; i += i & -i) this.tree.set(i, (this.tree.get(i) ?? 0) + height - old);
    return true;
  }
  top(index: number) {
    index = Math.max(0, Math.min(this.count, Math.floor(index)));
    let result = index * this.estimate;
    for (let i = index; i > 0; i -= i & -i) result += this.tree.get(i) ?? 0;
    return result;
  }
  at(pixel: number) {
    let index = 0,
      top = 0;
    // Descend the Fenwick tree once instead of summing a prefix at every probe.
    for (let step = 2 ** Math.floor(Math.log2(Math.max(1, this.count))); step >= 1; step /= 2) {
      const next = index + step;
      if (next > this.count) continue;
      const bottom = top + step * this.estimate + (this.tree.get(next) ?? 0);
      if (bottom <= pixel) {
        index = next;
        top = bottom;
      }
    }
    // Different addition order can round fractional boundaries differently.
    // Fall back to the original bounded search only at such a boundary.
    if (this.top(index) > pixel || (index < this.count && this.top(index + 1) <= pixel)) {
      let low = 0,
        high = this.count;
      while (low < high) {
        const mid = Math.floor((low + high + 1) / 2);
        if (this.top(mid) <= pixel) low = mid;
        else high = mid - 1;
      }
      index = low;
    }
    return Math.min(Math.max(0, this.count - 1), index);
  }
}
