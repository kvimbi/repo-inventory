import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const baseDir = resolve(fileURLToPath(new URL(".", import.meta.url)));

export default defineConfig({
  build: {
    outDir: "dist-electron",
    emptyOutDir: true,
    target: "node22",
    ssr: true,
    lib: {
      entry: {
        main: resolve(baseDir, "electron/main.ts"),
        preload: resolve(baseDir, "electron/preload.ts"),
      },
      formats: ["es"],
    },
    rollupOptions: {
      external: [
        "electron",
        /^node:.*/,
        "@ai-sdk/google",
        "@ai-sdk/mcp",
        "@fastify/static",
        "@modelcontextprotocol/sdk",
        "ai",
        "dompurify",
        "fastify",
        "marked",
        "zod",
      ],
      output: {
        entryFileNames: "[name].js",
        format: "esm",
      },
    },
  },
});
