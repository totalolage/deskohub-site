import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { runCommand } from "@/scripts/shared/command";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { workspaceE2ETimeouts } from "../timeouts";

const chromiumAvailable = await playwrightChromiumAvailable();
const summarySchema = z.object({
  milestones: z.object({ domContentLoaded: z.boolean(), load: z.boolean() }),
  pageErrors: z.number(),
  consoleErrors: z.number(),
  requests: z.array(
    z.object({
      group: z.string(),
      status: z.number().nullable(),
      outcome: z.enum(["pending", "failed", "finished"]),
      elapsedMs: z.number(),
    })
  ),
});

for (const heldDocument of [true, false]) {
  test.skipIf(!chromiumAvailable)(
    heldDocument
      ? "the anonymous render retains diagnostics when its unchanged navigation deadline expires"
      : "the anonymous render attaches no diagnostics when it passes",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "anonymous-navigation-"));
      const release = Promise.withResolvers<void>();
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        idleTimeout: 120,
        fetch() {
          if (heldDocument)
            return new Response(
              new ReadableStream({
                async start(controller) {
                  controller.enqueue(
                    new TextEncoder().encode(
                      "<!doctype html><h1>Loading content</h1>"
                    )
                  );
                  await release.promise;
                  controller.close();
                },
              }),
              { headers: { "content-type": "text/html" } }
            );
          return new Response(
            `<!doctype html><header>Fixture</header><main>
            <h1>My Workspace</h1><h2>Legal, privacy &amp; GDPR consents</h2>
            <a href="/privacy">Privacy Policy</a>
            <button onclick="this.remove()">Use necessary only</button>
            </main><footer>Fixture</footer>`,
            { headers: { "content-type": "text/html" } }
          );
        },
      });
      try {
        const config = join(directory, "playwright.config.mts");
        await writeFile(
          config,
          `import { defineConfig } from ${JSON.stringify(fileURLToPath(import.meta.resolve("@playwright/test")))};
          import { resolve } from 'node:path';
          import { workspaceE2EPlaywrightReporter } from ${JSON.stringify(join(import.meta.dir, "../playwright-defaults.ts"))};
          export default defineConfig({
            testDir: ${JSON.stringify(import.meta.dir)},
            testMatch: 'public-account-legal.pw.ts',
            grep: /renders anonymous public account legal at mobile 375/,
            timeout: ${workspaceE2ETimeouts.browserNavigation},
            workers: 1, retries: 0,
            outputDir: ${JSON.stringify(join(directory, "results"))},
            reporter: workspaceE2EPlaywrightReporter('Anonymous navigation capture acceptance').map(([name, options]) => [name.startsWith('.') ? resolve(${JSON.stringify(join(import.meta.dir, "../.."))}, name) : name, options]),
            use: { baseURL: ${JSON.stringify(server.url.origin)}, browserName: 'chromium', trace: 'off', video: 'off', screenshot: 'off' }
          });`
        );
        const result = await runCommand(
          [
            "bun",
            "x",
            "--no-install",
            "playwright",
            "test",
            "--config",
            config,
          ],
          {
            cwd: join(import.meta.dir, "../.."),
            env: {
              ...process.env,
              GITHUB_STEP_SUMMARY: join(directory, "summary.md"),
              JEST_WORKER_ID: undefined,
              WORKSPACE_E2E_BASE_URL: undefined,
              WORKSPACE_E2E_REVIEW_SCREENSHOTS: undefined,
            },
            timeoutMs: 90_000,
          }
        );
        expect(result.timedOut).toBe(false);
        const output = result.stdout + result.stderr;
        expect(result.exitCode, output).toBe(heldDocument ? 1 : 0);
        expect(output).toContain(heldDocument ? "1 failed" : "1 passed");
        const attachments: string[] = [];
        for await (const path of new Bun.Glob(
          "results/**/anonymous-navigation-diagnostics.json"
        ).scan(directory)) {
          attachments.push(join(directory, path));
        }
        expect(attachments).toHaveLength(heldDocument ? 1 : 0);
        if (heldDocument) {
          expect(output).toMatch(
            /(?:Timeout|Test timeout of) 60000ms exceeded/
          );
          const attachment = attachments[0];
          if (!attachment)
            throw new Error("Missing navigation diagnostics file");
          const body = await readFile(attachment, "utf8");
          const summary = summarySchema.parse(JSON.parse(body));
          expect(summary.milestones).toEqual({
            domContentLoaded: false,
            load: false,
          });
          expect(summary.requests).toEqual([
            {
              group: "Documents",
              status: 200,
              outcome: "pending",
              elapsedMs: expect.any(Number),
            },
          ]);
          expect(summary.requests[0]?.elapsedMs).toBeGreaterThanOrEqual(
            workspaceE2ETimeouts.browserNavigation - 1_000
          );
          expect(body).not.toContain(server.url.host);
        }
      } finally {
        release.resolve();
        await server.stop(true);
        await rm(directory, { recursive: true, force: true });
      }
    },
    120_000
  );
}
