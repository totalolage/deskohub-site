import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { type Browser, chromium, type Page } from "@playwright/test";
import { Effect } from "effect";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import {
  type ActionResponseOutcome,
  retainServerActionSubmission,
} from "./admin-case";
import { E2EBrowserSession } from "./browser-session";
import { runE2ECase } from "./case-runner";
import {
  type E2ETelemetryObservation,
  makeE2ETelemetryMock,
} from "./services/telemetry.mock";

// Admin cleanup closes the session before it awaits a retained Server Action
// submission, so no late request can leave the browser. These pin how a
// retained submission settles around that close against a real Chromium.
const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
let heldAction: PromiseWithResolvers<Response> | undefined;
let heldActionArrived: PromiseWithResolvers<void> | undefined;

beforeAll(async () => {
  if (!chromiumAvailable) return;
  browser = await chromium.launch({ headless: true });
  server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const { pathname } = new URL(request.url);
      if (pathname === "/action") {
        if (heldAction) {
          heldActionArrived?.resolve();
          return heldAction.promise;
        }
        return new Response("saved");
      }
      return new Response(
        `<!doctype html><title>Admin</title>
        <button id="submit" onclick="fetch('/action', { method: 'POST', headers: { 'next-action': 'synthetic' }, body: 'x' })">Save</button>`,
        { headers: { "content-type": "text/html; charset=utf-8" } }
      );
    },
  });
});

afterAll(async () => {
  await browser?.close();
  await server?.stop(true);
});

const origin = () => {
  if (!server) throw new Error("test server is not running");
  return `http://localhost:${server.port}`;
};

/**
 * Opens the admin page, retains the next Server Action submission, runs
 * `act`, closes the session, and only then awaits the submission, as admin
 * cleanup does.
 */
const submitAndClose = (act: (page: Page) => Promise<void>) => {
  if (!browser) throw new Error("Chromium is not running");
  const opening = E2EBrowserSession.open({
    browser,
    id: `admin-case-test-${randomUUID()}`,
    recordHar: false,
  });
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const session = yield* opening;
        let submission: Promise<ActionResponseOutcome> | undefined;
        yield* session.use("submit the admin form", async (page) => {
          await page.goto(`${origin()}/`);
          submission = retainServerActionSubmission(page, origin());
          await act(page);
        });
        yield* session.close();
        return yield* Effect.promise(
          () => submission ?? Promise.reject(new Error("no submission"))
        );
      })
    )
  );
};

test.skipIf(!chromiumAvailable)(
  "settles a submission the browser never sent as undispatched once the session closes",
  async () => {
    expect(await submitAndClose(async () => undefined)).toEqual({
      kind: "undispatched",
    });
  }
);

test.skipIf(!chromiumAvailable)(
  "settles a sent submission through its response",
  async () => {
    expect(
      await submitAndClose(async (page) => {
        const answered = page.waitForResponse(`${origin()}/action`);
        await page.locator("#submit").click();
        await answered;
      })
    ).toEqual({ kind: "responded" });
  }
);

test.skipIf(!chromiumAvailable)(
  "settles a sent submission still awaiting its response as unresolved",
  async () => {
    heldAction = Promise.withResolvers<Response>();
    heldActionArrived = Promise.withResolvers<void>();
    const arrived = heldActionArrived.promise;
    try {
      expect(
        await submitAndClose(async (page) => {
          await page.locator("#submit").click();
          await arrived;
        })
      ).toEqual({ kind: "unresolved" });
    } finally {
      heldAction.resolve(new Response("late"));
      heldAction = undefined;
    }
  }
);

test.skipIf(!chromiumAvailable)(
  "reports an admin step's Playwright timeout as a timed-out case",
  async () => {
    if (!browser) throw new Error("Chromium is not running");
    const opening = E2EBrowserSession.open({
      browser,
      id: `admin-case-test-${randomUUID()}`,
      recordHar: false,
    });
    const observations: E2ETelemetryObservation[] = [];
    await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const session = yield* opening;
          yield* runE2ECase({
            body: (step) =>
              step({
                execute: session.use(
                  "wait for the admin form",
                  async (page) => {
                    await page.goto(`${origin()}/`);
                    await page.locator("#missing").waitFor({ timeout: 50 });
                  }
                ),
                id: "wait-for-admin-form",
                timeoutMs: 5000,
              }),
            caseId: "admin-timeout",
            watchdogMs: 10_000,
          });
        })
      ).pipe(Effect.provide(makeE2ETelemetryMock(observations)))
    );

    expect(observations.filter(({ scope }) => scope === "annotation")).toEqual([
      {
        caseId: "admin-timeout",
        failureKind: "timeout",
        outcome: "timed_out",
        scope: "annotation",
        stepId: "wait-for-admin-form",
      },
    ]);
  }
);
