import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 4101,
    strictPort: true,
    proxy: { "/v1": "http://127.0.0.1:4102" },
    fs: {
      deny: [
        "**/.env",
        "**/.env.*",
        "**/plans/**",
        "**/.git/**",
        "**/.passage/**",
      ],
    },
    watch: {
      ignored: [
        "**/.passage/**",
        "**/test-results/**",
        "**/playwright-report/**",
        "**/plans/**",
      ],
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 4101,
    strictPort: true,
    proxy: { "/v1": "http://127.0.0.1:4102" },
  },
  build: { sourcemap: false, target: "es2022" },
});
