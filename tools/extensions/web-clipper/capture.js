// Self-contained function serialized by chrome.scripting.executeScript.
export function capturePage(mode) {
  if (!["http:", "https:"].includes(location.protocol)) throw new Error("HTTP(S) 페이지에서만 사용할 수 있습니다.");
  let html;
  if (mode === "selection") {
    const selection = getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount)
      throw new Error("먼저 페이지의 텍스트를 선택하세요.");
    // Visible selected text avoids serializing hidden descendants inside a range.
    const container = document.createElement("div");
    container.textContent = selection.toString();
    html = container.innerHTML.replaceAll("\n", "<br>");
  } else if (mode === "page") {
    const source = document.querySelector("article,main") || document.body;
    if (!source) throw new Error("페이지 본문이 없습니다.");
    const copy = source.cloneNode(true);
    const originals = [...source.querySelectorAll("*")],
      clones = [...copy.querySelectorAll("*")];
    for (let i = originals.length - 1; i >= 0; i--) {
      const style = getComputedStyle(originals[i]);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        originals[i].hidden ||
        originals[i].getAttribute("aria-hidden") === "true"
      )
        clones[i].remove();
    }
    copy
      .querySelectorAll("script,style,iframe,form,input,textarea,select,button,svg,img,video,audio")
      .forEach((node) => node.remove());
    html = copy.innerHTML;
  } else throw new Error("지원하지 않는 클리핑 모드입니다.");
  if (new TextEncoder().encode(html).length > 2 * 1024 * 1024)
    throw new Error("내용이 2 MiB를 넘습니다. 작은 영역을 선택하세요.");
  return { id: crypto.randomUUID(), title: document.title.slice(0, 250), url: location.href, html };
}
