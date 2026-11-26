import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { alphaTab } from "@coderline/alphatab-vite";

export default defineConfig({
  // alphaTab's plugin wires up its rendering/audio workers and copies the notation font
  // (dist/font) and soundfont (dist/soundfont) into the build.
  plugins: [react(), alphaTab()],
  build: {
    outDir: "dist",
    target: "es2022",
    sourcemap: false,
    // alphaTab's engine is one ~1.2 MB chunk (about 300 KB compressed). It's lazy-loaded only
    // when a tab preview opens, so it doesn't affect normal page loads.
    chunkSizeWarningLimit: 1500,
  },
  server: { port: 8080 },
});
