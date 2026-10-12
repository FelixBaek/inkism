function utf8Length(cp: number): number {
  if (cp <= 0x7f) return 1;
  if (cp <= 0x7ff) return 2;
  return cp <= 0xffff ? 3 : 4;
}
// Map a canonical UTF-8 offset into the existing JS string outside the UI thread.
self.onmessage = (event: MessageEvent<{ source: string; start: number; expected: string }>) => {
  const { source, start, expected } = event.data;
  try {
    let byte = 0,
      from = 0;
    while (byte < start && from < source.length) {
      const cp = source.codePointAt(from)!;
      byte += utf8Length(cp);
      from += cp > 0xffff ? 2 : 1;
    }
    if (byte !== start || source.slice(from, from + expected.length) !== expected)
      throw new Error("document range changed");
    self.postMessage({ from, to: from + expected.length });
  } catch {
    self.postMessage({ error: "문서 구간이 변경되었습니다. 다시 불러와 주세요." });
  }
};
