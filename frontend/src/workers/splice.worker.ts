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
  } catch (error) {
    self.postMessage({ id, error_code: "splice_compute_failed", error: error instanceof Error ? error.message : String(error) });
  }
};
