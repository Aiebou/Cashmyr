import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// GitHub Pages sert l'application sous /Cashmyr/ ; en développement, à la racine.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/Cashmyr/" : "/",
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  build: { target: "es2022", sourcemap: true },
}));
