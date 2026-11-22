import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// Two single-file builds (the app and the light thinking page), both embedded
// into convex/lib/assets.ts so the Convex deployment serves everything itself.
const entry = process.env.GO_ENTRY ?? "index";

export default defineConfig({
  root: "web",
  envDir: "..",
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: `dist/${entry}`,
    emptyOutDir: true,
    rollupOptions: { input: `web/${entry}.html` },
  },
  server: { port: 5173 },
});
