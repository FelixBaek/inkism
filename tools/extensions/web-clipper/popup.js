import { capturePage } from "./capture.js";
const el = (id) => document.getElementById(id);
el("extension").value = chrome.runtime.id;
el("capture").addEventListener("click", async () => {
  const button = el("capture");
  if (button.disabled) return;
  button.disabled = true;
  el("status").textContent = "가져오는 중…";
  try {
    const url = new URL(el("address").value);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      !url.port ||
      url.pathname !== "/capture" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("앱에 표시된 127.0.0.1 수신 주소를 입력하세요.");
    const token = el("token").value;
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("앱의 연결 토큰을 입력하세요.");
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("활성 탭을 찾지 못했습니다.");
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: capturePage,
      args: [el("mode").value],
    });
    if (!result) throw new Error("선택 영역을 가져오지 못했습니다.");
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(result),
      signal: AbortSignal.timeout(10000),
    });
    const value = await response.json();
    if (!response.ok || !value.ok) throw new Error(value.error || "앱 전송에 실패했습니다.");
    el("status").textContent = "Inkism에서 미리 보고 새 노트로 저장하세요.";
  } catch (error) {
    el("status").textContent = error.message || "전송에 실패했습니다. 앱의 대기 항목을 확인한 뒤 다시 시도하세요.";
  } finally {
    button.disabled = false;
  }
});
