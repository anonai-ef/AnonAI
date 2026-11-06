import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "./" so the built site works at any path (GitHub Pages project sites, Vercel, a local file server).
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: { outDir: "dist", sourcemap: false },
});
