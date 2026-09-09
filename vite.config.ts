import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

export default defineConfig({
  root: "web",
  base: "./",
  plugins: [react(), tailwind()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  server: {
    port: 4748,
    proxy: {
      "^/api(/|$)": "http://127.0.0.1:4747",
    },
  },
});
