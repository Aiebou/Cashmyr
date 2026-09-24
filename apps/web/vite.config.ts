/// <reference types="node" />
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

/**
 * La page ne peut charger que ses propres fichiers : aucune requête vers un tiers n'est
 * possible, même par erreur (même règle que la CSP du bureau). GitHub Pages ne permet pas
 * d'en-têtes, d'où la balise meta. En développement, React Refresh a besoin de scripts en ligne.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
].join("; ");

const contentSecurityPolicy = (): Plugin => ({
  name: "cashmyr-csp",
  apply: "build",
  transformIndexHtml: () => [
    { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" },
  ],
});

// GitHub Pages sert l'application sous /Cashmyr/, comme `vite preview` ; en développement, à la racine.
export default defineConfig(({ command, isPreview }) => {
  const base = command === "build" || isPreview ? "/Cashmyr/" : "/";
  return {
    base,
    define: { __APP_VERSION__: JSON.stringify(version) },
    plugins: [
      react(),
      contentSecurityPolicy(),
      VitePWA({
        // Une nouvelle version attend que l'utilisateur accepte de recharger (bandeau), jamais de force.
        registerType: "prompt",
        // Enregistré par src/platform.ts, via `virtual:pwa-register`.
        injectRegister: false,
        // Les icônes sont déjà dans la liste ci-dessous ; le manifeste y est ajouté par le plugin.
        includeManifestIcons: false,
        manifest: {
          id: base,
          name: "Cashmyr",
          short_name: "Cashmyr",
          description: "Budget personnel hors ligne : tes données restent sur tes appareils.",
          lang: "fr",
          dir: "ltr",
          start_url: base,
          scope: base,
          display: "standalone",
          background_color: "#f1f0ea",
          theme_color: "#f1f0ea",
          categories: ["finance"],
          icons: [
            { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            { src: "icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
            { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        workbox: {
          // Toute la coquille est précachée : pages, scripts, styles, polices, icônes. Pas les cartes de sources.
          globPatterns: ["**/*.{html,js,css,woff2,png}"],
          navigateFallback: "index.html",
          cleanupOutdatedCaches: true,
          // Aucun cache à l'exécution : l'application ne demande rien d'autre au réseau.
          runtimeCaching: [],
        },
      }),
    ],
    server: { port: 5173, strictPort: true },
    build: { target: "es2022", sourcemap: true },
  };
});
