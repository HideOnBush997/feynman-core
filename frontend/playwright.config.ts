import { defineConfig } from "@playwright/test";
import fs from "node:fs";
const cert =
  process.env.HTTPS_CERT_FILE || "D:/Codex/Work/feynman-certs/localhost.pem";
const key =
  process.env.HTTPS_KEY_FILE || "D:/Codex/Work/feynman-certs/localhost.key";
const secure = fs.existsSync(cert) && fs.existsSync(key);
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 10000 },
  retries: 0,
  reporter: "list",
  use: {
    viewport: { width: 1440, height: 1100 },
    baseURL:
      process.env.E2E_BASE_URL ||
      `${secure ? "https" : "http"}://localhost:5173`,
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: `${secure ? "https" : "http"}://localhost:5173`,
    reuseExistingServer: !process.env.CI,
    ignoreHTTPSErrors: true,
    env: secure ? { HTTPS_CERT_FILE: cert, HTTPS_KEY_FILE: key } : {},
  },
});
