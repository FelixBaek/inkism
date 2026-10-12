// Compress only offscreen spacers. The mounted editor keeps normal CSS pixels.
export const MAX_SPACER_HEIGHT = 8_000_000;
export function scrollSpace(total: number, start: number, end: number) {
  const outside = Math.max(0, total - (end - start));
  const scale = outside > MAX_SPACER_HEIGHT ? MAX_SPACER_HEIGHT / outside : 1;
  const before = start * scale;
  const after = Math.max(0, total - end) * scale;
  return {
    before,
    after,
    scale,
    start,
    end,
    logicalAt(pixel: number, visibleHeight: number) {
      if (pixel < before) return pixel / scale;
      if (pixel <= before + visibleHeight) return start + pixel - before;
      return end + (pixel - before - visibleHeight) / scale;
    },
  };
}
