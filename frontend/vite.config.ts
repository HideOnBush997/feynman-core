import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import { loadEnv } from "vite";
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  const cert = env.HTTPS_CERT_FILE;
  const key = env.HTTPS_KEY_FILE;
  return {
    plugins: [react()],
    server: {
      port: 5173,
      https:
        cert && key
          ? { cert: fs.readFileSync(cert), key: fs.readFileSync(key) }
          : undefined,
      proxy: {
        "/api": {
          target: env.API_PROXY_TARGET || "https://localhost:7043",
          secure: false,
        },
      },
    },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test-setup.ts"],
      include: ["src/**/*.test.{ts,tsx}"],
      restoreMocks: true,
    },
  };
});
