// 설정 창과 화면 도구가 같이 쓰는 작은 저장 설정. 한쪽에서 바꾸면 다른 쪽도 바로 따라간다.
import { useEffect, useState } from "react";

const EVENT = "inkism-pref";

export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage can be unavailable; the value still applies to this window
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { key, value } }));
}

export function usePref<T>(key: string, parse: (raw: string | null) => T): [T, (value: T) => void] {
  const [value, setValue] = useState(() => parse(readPref(key)));
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ key: string; value: string }>).detail;
      if (d.key === key) setValue(parse(d.value));
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
    // parse is a module-level function at every call site
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return [value, (next: T) => writePref(key, String(next))];
}
