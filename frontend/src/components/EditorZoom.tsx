import React, { useEffect } from "react";
import { Minus, Plus } from "../icons";
import { usePref } from "../lib/pref";
import { t } from "../i18n";

export const parseZoom = (raw: string | null) => {
  const n = Number(raw);
  return n >= MIN && n <= MAX ? n : 100;
};
const MIN = 75;
const MAX = 200;
// 10% 눈금에 맞춘다: 75에서 +는 80, 80에서 −는 75.
const up = (z: number) => Math.min(MAX, Math.floor(z / 10) * 10 + 10);
const down = (z: number) => Math.max(MIN, Math.ceil(z / 10) * 10 - 10);

export function EditorZoom() {
  const [zoom, setZoom] = usePref("inkism.editor.zoom", parseZoom);
  useEffect(() => {
    document.documentElement.style.setProperty("--editor-zoom", String(zoom / 100));
  }, [zoom]);
  return (
    <div className="editor-zoom" aria-label={t("본문 확대·축소")}>
      <button aria-label={t("본문 축소")} disabled={zoom <= MIN} onClick={() => setZoom(down(zoom))}>
        <Minus size={16} />
      </button>
      <button aria-label={t("본문 기본 배율")} onClick={() => setZoom(100)}>
        {zoom}%
      </button>
      <button aria-label={t("본문 확대")} disabled={zoom >= MAX} onClick={() => setZoom(up(zoom))}>
        <Plus size={16} />
      </button>
    </div>
  );
}
