import { expect, test } from "bun:test";
import { chromium } from "@playwright/test";
import { withNextAppFixture } from "@/shared/testing/next-app-fixture.test-utils";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { prefetchRoute } from "./navigation-test-helpers";

const chromiumAvailable = await playwrightChromiumAvailable();

// Hold the real Flight payload while Next's client modules load. The router is
// exposed at this point, but its action queue cannot initialize until release.
test.skipIf(!chromiumAvailable)(
  "prefetch waits for App Router hydration and preserves prefetch failures",
  async () => {
    await withNextAppFixture(
      {
        name: "navigation-readiness",
        files: {
          // The HTTP proxy holds Flight, not the development debug WebSocket.
          "next.config.mjs": `export default {
            experimental: { reactDebugChannel: false }
          };`,
          "app/layout.tsx": `export default function Layout({ children }) {
            return <html><body>{children}</body></html>;
          }`,
          "app/page.tsx": `import Link from 'next/link';
            export default function Page() {
              return <header><Link href='/'>Deskohub Workspace</Link></header>;
            }`,
          "app/cached/page.tsx": `export default function Page() {
            return <p>Cached destination</p>;
          }`,
        },
      },
      async (fixture) => {
        const release = Promise.withResolvers<void>();
        const proxy = Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          idleTimeout: 60,
          async fetch(request) {
            const url = new URL(request.url);
            const response = await fetch(
              new URL(url.pathname + url.search, fixture.url),
              { headers: request.headers }
            );
            if (url.pathname !== "/") {
              const headers = new Headers(response.headers);
              headers.delete("content-encoding");
              headers.delete("content-length");
              return new Response(response.body, {
                status: response.status,
                headers,
              });
            }
            const html = await response.text();
            const scripts =
              html.match(/<script[^>]*>[\s\S]*?<\/script>/g) ?? [];
            const flight = scripts.filter((script) =>
              script.includes("__next_f")
            );
            if (!flight?.length) throw new Error("Missing Next Flight payload");
            const shell = flight
              .reduce((shell, script) => shell.replace(script, ""), html)
              .replace(/<\/body>\s*<\/html>\s*$/, "");
            const encoder = new TextEncoder();
            return new Response(
              new ReadableStream({
                async start(controller) {
                  controller.enqueue(encoder.encode(shell));
                  await release.promise;
                  controller.enqueue(
                    encoder.encode(flight.join("") + "</body></html>")
                  );
                  controller.close();
                },
              }),
              { headers: { "content-type": "text/html; charset=utf-8" } }
            );
          },
        });
        const browser = await chromium.launch({ headless: true });
        try {
          const page = await browser.newPage();
          page.setDefaultTimeout(30_000);
          await page.goto(`http://127.0.0.1:${proxy.port}`, {
            waitUntil: "commit",
          });
          await page.waitForFunction(() => window.next?.router !== undefined);
          // This also exercises the helper's already-prefetched resource path.
          await page.evaluate(() => fetch("/cached").then((r) => r.text()));
          const earlyError = await page.evaluate(() => {
            try {
              window.next?.router?.prefetch("/cached");
            } catch (error) {
              return String(error);
            }
          });
          expect(earlyError).toContain(
            "Router action dispatched before initialization"
          );
          const unhydrated = await prefetchRoute(page, "/cached").then(
            () => undefined,
            (error: unknown) => error
          );
          expect(unhydrated).toMatchObject({ name: "TimeoutError" });
          const pending = prefetchRoute(page, "/cached");
          // Observe the result immediately so an old-helper rejection is handled.
          const outcome = pending.then(
            () => ({ error: undefined }),
            (error: unknown) => ({ error })
          );
          release.resolve();
          const result = await outcome;
          expect(result.error).toBeUndefined();
          await page.waitForLoadState("load");
          await prefetchRoute(page, "/cached");

          const failure = await prefetchRoute(page, "javascript:void(0)").then(
            () => undefined,
            (error: unknown) => error
          );
          expect(String(failure)).toContain(
            "Next.js has blocked a javascript:"
          );
        } finally {
          release.resolve();
          await browser.close();
          await proxy.stop(true);
        }
      }
    );
  },
  120_000
);
