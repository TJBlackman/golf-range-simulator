import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  server: { port: 5178, strictPort: true },
  build: {
    target: "es2022",
    // The renderer is a single shared engine; keep it cached separately from game code.
    chunkSizeWarningLimit: 750,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "three-engine", test: /node_modules[\\/]three[\\/]/ },
          ],
        },
      },
    },
  },
});
