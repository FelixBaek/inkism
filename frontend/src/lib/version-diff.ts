// 버전 비교: 저장된 원문을 문단(줄) 목록으로 바꾸고, 줄 단위 LCS로 이전↔지금을 나란히 맞춘다.

export type DiffRow = { left: string | null; right: string | null; kind: "same" | "change" };
export type DiffResult = { rows: DiffRow[]; added: number; removed: number } | { tooLarge: true };

// ponytail: LCS는 O(n·m)이다. 큰 노트는 비교를 생략하고 안내만 한다. 필요하면 Myers diff로 바꾼다.
const MAX_CELLS = 4_000_000;

/** html이면 블록 단위 글자로, 나머지는 줄 단위로 나눈다. 빈 줄은 버린다. */
export function toLines(content: string, format: string | undefined): string[] {
  if (format === "html" || format === undefined) {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const out: string[] = [];
    const blocks = doc.body.querySelectorAll("p,li,h1,h2,h3,h4,h5,h6,pre,blockquote,td,th,figcaption");
    for (const el of Array.from(blocks)) {
      if (el.querySelector("p,li,h1,h2,h3,h4,h5,h6,pre,td,th")) continue; // 바깥 블록은 안쪽에서 센다
      const t = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (t) out.push(t);
    }
    if (out.length === 0) {
      const t = (doc.body.textContent ?? "").trim();
      if (t)
        out.push(
          ...t
            .split(/\n+/)
            .map((x) => x.trim())
            .filter(Boolean),
        );
    }
    return out;
  }
  return content
    .split(/\r?\n/)
    .map((x) => x.trimEnd())
    .filter((x) => x.trim() !== "");
}

export function diffLines(before: string[], after: string[]): DiffResult {
  const n = before.length,
    m = after.length;
  if (n * m > MAX_CELLS) return { tooLarge: true };
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i][j] = before[i] === after[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const rows: DiffRow[] = [];
  let added = 0,
    removed = 0,
    i = 0,
    j = 0;
  let dels: string[] = [],
    adds: string[] = [];
  const flush = () => {
    for (let k = 0; k < Math.max(dels.length, adds.length); k++)
      rows.push({ left: dels[k] ?? null, right: adds[k] ?? null, kind: "change" });
    dels = [];
    adds = [];
  };
  while (i < n || j < m) {
    if (i < n && j < m && before[i] === after[j]) {
      flush();
      rows.push({ left: before[i], right: after[j], kind: "same" });
      i++;
      j++;
    } else if (j < m && (i === n || lcs[i][j + 1] >= lcs[i + 1][j])) {
      adds.push(after[j]);
      added += Array.from(after[j]).length;
      j++;
    } else {
      dels.push(before[i]);
      removed += Array.from(before[i]).length;
      i++;
    }
  }
  flush();
  return { rows, added, removed };
}
