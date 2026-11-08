/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  return {
    plugins: [react()],
    build: {
      // Шрифты всегда отдельными файлами: CSP сервера (font-src 'self') блокирует data:-шрифты.
      assetsInlineLimit: (file: string) => (/\.(woff2?|ttf|otf|eot)$/i.test(file) ? false : undefined),
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": { target: env.VITE_PROXY_TARGET || "http://127.0.0.1:8000", changeOrigin: false },
      },
    },
    test: {
      environment: "jsdom",
      setupFiles: ["src/test/setup.ts"],
    },
  };
});
