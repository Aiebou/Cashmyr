/// <reference types="node" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Servie par Tauri depuis le disque : base relative, aucun appel réseau.
// Cibles : WebKit sur macOS et Linux, WebView2 (Chromium) sur Windows. color-mix() demande Safari 16.2.
export default defineConfig({
  base: "./",
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari16",
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
  },
});
