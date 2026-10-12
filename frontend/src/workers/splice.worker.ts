import { bodySplice } from "../lib/body-splice";
self.onmessage = (
  event: MessageEvent<{
    id: number;
    before: { content: string; text: string };
    after: { content: string; text: string };
  }>,
) => {
  const { id, before, after } = event.data;
  try {
    self.postMessage({
      id,
      content: bodySplice(before.content, after.content),
      text: bodySplice(before.text, after.text),
    });
  } catch {
    self.postMessage({ id, error: "변경 구간을 계산하지 못했습니다." });
  }
};
