const BLOCK_TAGS = /^(P|H[1-6]|LI|PRE|BLOCKQUOTE|TD|TH|SUMMARY|DIV)$/;

/** HTML에서 보이는 글자를 블록 단위로 꺼낸다. 중첩 블록(목록 안 문단 등)은 가장 안쪽 블록만 쓴다. */
export function htmlBlocks(html: string): string[] {
  const root = document.createElement("template");
  root.innerHTML = html;
  const parts: string[] = [];
  root.content.querySelectorAll("p,h1,h2,h3,h4,h5,h6,li,pre,td,th,summary").forEach((el) => {
    if (!Array.from(el.children).some((child) => BLOCK_TAGS.test(child.tagName))) parts.push(el.textContent ?? "");
  });
  return (parts.length ? parts : [root.content.textContent ?? ""])
    .map((b) => b.replaceAll("\u00a0", " "))
    .filter((b) => b.trim());
}

/** 노트의 평문. HTML 원문 저장 경로는 text=content(아직 안 뽑음)로 남기므로 여기서 뽑는다. */
export function plainTextOf(note: { content: string; text: string; content_format?: string | null }): string {
  const format = note.content_format ?? "html";
  if (format === "text") return note.content;
  if (format === "html" && (note.text === note.content || /^\s*</.test(note.text)))
    return htmlBlocks(note.content).join("\n");
  return note.text;
}

/** 사용자에게 보여 줄 오류 문구. "RpcError:"·"Error:" 같은 개발자용 접두를 뺀다. */
export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
