import { useSyncExternalStore } from "react";

// mobile.css와 같은 경계. 둘 중 한 곳에만 그려야 하는 셸 부품(동기화 표시 등)에 쓴다.
const query = typeof matchMedia === "function" ? matchMedia("(max-width: 760px)") : null;

export function useNarrow(): boolean {
  return useSyncExternalStore(
    (change) => {
      query?.addEventListener("change", change);
      return () => query?.removeEventListener("change", change);
    },
    () => query?.matches ?? false,
  );
}
