import { defineConfig } from "vite";
import {pdfAssets} from "./pdf-assets";
import react from "@vitejs/plugin-react";

// Go 셸이 정적 자산을 서빙하고, API는 동일 오리진의 /api 로 제공된다.
// 개발 중에는 vite 프록시가 /api 를 127.0.0.1:47831 로 전달한다.
export default defineConfig({
  base: "./",
  plugins: [react(),pdfAssets()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:47831",
        changeOrigin: true,
        configure(proxy, options) {
          proxy.on("proxyReq", (forwarded, request) => {
            const origin = request.headers.origin;
            if (!origin || request.headers["sec-fetch-site"] === "cross-site") return;
            try {
              const source = new URL(origin);
              // changeOrigin rewrites Host but not Origin. Translate only a
              // same-origin request to this dev server; foreign origins remain
              // untouched and are rejected by the Go bridge.
              if ((source.protocol === "http:" || source.protocol === "https:")
                && source.host === request.headers.host) {
                forwarded.setHeader("Origin", new URL(options.target as string).origin);
              }
            } catch { /* Preserve malformed origins for backend rejection. */ }
          });
        },
      },
    },
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1600,
  },
  worker: {
    format: "es",
  },
});
