import { t } from "../i18n";
import React, { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "../icons";

type AppWindow = {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  close: () => Promise<void>;
};

declare global {
  interface Window {
    __TAURI__?: { window: { getCurrentWindow: () => AppWindow } };
  }
}

const appWindow = () => window.__TAURI__?.window.getCurrentWindow();

/** Closing goes through the native close request, which keeps the existing save-before-close and locked-close paths. */
export function WindowControls() {
  const [maximised, setMaximised] = useState(false);
  useEffect(() => {
    let mounted = true;
    const refresh = () =>
      void appWindow()
        ?.isMaximized()
        .then((value) => {
          if (mounted) setMaximised(value);
        })
        .catch(() => {});
    refresh();
    window.addEventListener("resize", refresh);
    return () => {
      mounted = false;
      window.removeEventListener("resize", refresh);
    };
  }, []);
  if (!appWindow()) return null;
  return (
    <div className="native-window-controls" aria-label={t("창 제어")} data-tauri-drag-region="false">
      <button
        type="button"
        aria-label={t("창 최소화")}
        title={t("최소화")}
        onClick={() => void appWindow()?.minimize()}
      >
        <Minus size={13} aria-hidden />
      </button>
      <button
        type="button"
        aria-label={maximised ? t("창 크기 복원") : t("창 최대화")}
        title={maximised ? t("이전 크기로") : t("최대화")}
        onClick={() => void appWindow()?.toggleMaximize()}
      >
        {maximised ? <Copy size={12} aria-hidden /> : <Square size={12} aria-hidden />}
      </button>
      <button
        type="button"
        className="native-window-close"
        aria-label={t("창 닫기")}
        title={t("닫기")}
        onClick={() => void appWindow()?.close()}
      >
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}
