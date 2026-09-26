import { defineConfig } from "@playwright/test";

// Isolated runner regression for the marketing-communications document hash:
// no webServer, no global setup, no project dependencies, no browser fixture,
// no environment-file loading. Artifacts stay under .artifacts.
export default defineConfig({
  forbidOnly: true,
  fullyParallel: false,
  outputDir: "../../.artifacts/e2e-marketing-document-hash",
  projects: [
    {
      name: "marketing-document-hash",
      testDir: ".",
      testMatch: "marketing-document-hash.pw.ts",
      use: {
        screenshot: "off",
        trace: "off",
        video: "off",
      },
    },
  ],
  reporter: [["line"]],
  retries: 0,
  workers: 1,
});
