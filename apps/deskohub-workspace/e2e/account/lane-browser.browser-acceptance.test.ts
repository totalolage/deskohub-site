import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { type Browser, chromium } from "@playwright/test";
import { Effect, Scope } from "effect";
import { getAccountSectionPath } from "@/features/account/routes";
import { sharedReferralCodeRememberedDays } from "@/features/referrals/program";
import { referralCodeCookieName } from "@/features/referrals/referral-code-cookie";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import {
  E2EBrowserSession,
  type OpenE2EBrowserSession,
} from "../browser-session";
import { runE2ECase } from "../case-runner";
import { isWorkspaceE2ETimeout, type WorkspaceE2EError } from "../errors";
import {
  type E2ETelemetryObservation,
  makeE2ETelemetryMock,
} from "../services/telemetry.mock";
import { workspaceE2ETimeouts } from "../timeouts";
import { buildAccountSectionsHarness } from "./account-sections.browser-harness.test-utils";
import { makeWorkspaceE2EAccountLaneBrowser } from "./lane-browser";

// The account cases drive these steps on the lane's own session, so each runs
// here on a real browser session, opened on first use as in the lane.
const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;
let harness = { script: "", styles: "" };

beforeAll(async () => {
  if (!chromiumAvailable) return;
  harness = await buildAccountSectionsHarness();
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
});

// HTTPS, so the page may write the Secure cookie a shared link leaves.
const origin = "https://workspace.example.test";
// Long enough for several cookie reads at the browser poll interval.
const config = {
  baseUrl: origin,
  bypassSecret: undefined,
  timeouts: { ...workspaceE2ETimeouts, uiTransition: 3000 },
};
const sharedCode = "RFLSYNTHETICLANE";
const otherCode = "RFLSYNTHETICOTHER";

/** How a lane step that should have failed failed, if it did. */
const failureOf = (effect: Effect.Effect<void, WorkspaceE2EError>) =>
  effect.pipe(
    Effect.match({
      onFailure: (failure) => ({
        operation: failure.operation,
        timeout: isWorkspaceE2ETimeout(failure),
      }),
      onSuccess: () => "succeeded" as const,
    })
  );

/**
 * Serves the account page inside the lane session's context: the hydrated
 * AccountShell, which remembers a `?ref=` code the way a shared link does.
 */
const serveAccountPage = (openSession: OpenE2EBrowserSession) =>
  Effect.flatMap(openSession, (laneSession) =>
    laneSession.use("serve the account page", (page) =>
      page.context().route(`${origin}/**`, (route) => {
        const { pathname } = new URL(route.request().url());
        if (pathname === "/harness.js")
          return route.fulfill({
            body: harness.script,
            contentType: "text/javascript",
          });
        return route.fulfill({
          body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${harness.styles}</style><script>
            const code = new URLSearchParams(location.search).get("ref");
            if (code) document.cookie = ${JSON.stringify(`${referralCodeCookieName}=`)} + code + "; Path=/; Max-Age=${sharedReferralCodeRememberedDays * 24 * 60 * 60}; Secure; SameSite=Lax";
          </script></head><body><div id="account-sections-test-root"></div><script src="/harness.js"></script></body></html>`,
          contentType: "text/html; charset=utf-8",
        });
      })
    )
  );

/** A lane session in `laneBrowser`, opened on first use in the caller's Scope. */
const openLaneSession = (laneBrowser: Browser, id: string) =>
  E2EBrowserSession.openOnFirstUse({
    browser: laneBrowser,
    id,
    recordHar: false,
  });

/**
 * The lane browser over the lane's session, its own assistant session, and
 * separate sessions, all owned by the caller's Scope.
 */
const laneBrowserOver = (
  laneBrowser: Browser,
  openSession: OpenE2EBrowserSession
) =>
  Effect.gen(function* () {
    const laneScope = yield* Effect.scope;
    const openAssistantSession = yield* openLaneSession(
      laneBrowser,
      `account-lane-assistant-${randomUUID()}`
    );
    return makeWorkspaceE2EAccountLaneBrowser({
      config,
      openAssistantSession,
      openSeparateSession: (name) =>
        Effect.flatten(
          openLaneSession(
            laneBrowser,
            `account-lane-${name}-${randomUUID()}`
          ).pipe(Scope.provide(laneScope))
        ),
      openSession,
    });
  });

test.skipIf(!chromiumAvailable)("drives the lane's own page", async () => {
  if (!browser) throw new Error("Chromium is not running");
  const real = browser;
  const { absentCodeWait, otherCodeWait, selected } = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const openSession = yield* openLaneSession(
          real,
          `account-lane-${randomUUID()}`
        );
        const laneBrowser = yield* laneBrowserOver(real, openSession);
        yield* serveAccountPage(openSession);
        yield* laneBrowser.open(`${origin}/en-US/account?ref=${sharedCode}`);
        yield* laneBrowser.waitForRememberedReferralCode(sharedCode);
        // The waits read this lane's cookie for the code they were given.
        const [otherCodeWait, absentCodeWait] = yield* Effect.all(
          [
            failureOf(laneBrowser.waitForRememberedReferralCode(otherCode)),
            failureOf(laneBrowser.waitForNoRememberedReferralCode),
          ],
          { concurrency: "unbounded" }
        );
        yield* laneBrowser.selectSection("billing");
        const laneSession = yield* openSession;
        const selected = yield* laneSession.evaluate(
          "read the selected section",
          () =>
            Array.from(
              document.querySelectorAll<HTMLAnchorElement>(
                'nav a[aria-current="page"]'
              )
            )
              .filter((link) => link.getBoundingClientRect().width > 0)
              .map((link) => link.getAttribute("href"))
              .join(" "),
          undefined
        );
        // Another lane session is another context, which remembers nothing.
        const fresh = yield* laneBrowserOver(
          real,
          yield* openLaneSession(real, `account-lane-fresh-${randomUUID()}`)
        );
        yield* fresh.waitForNoRememberedReferralCode;
        return { absentCodeWait, otherCodeWait, selected };
      })
    )
  );

  expect(otherCodeWait).toEqual({
    operation: "remembered referral code cookie",
    timeout: true,
  });
  expect(absentCodeWait).toEqual({
    operation: "no remembered referral code cookie",
    timeout: true,
  });
  expect(selected).toBe(getAccountSectionPath("en-US", "billing"));
});

test.skipIf(!chromiumAvailable)(
  "fails the calling step when the lane browser cannot open",
  async () => {
    const closed = await chromium.launch({ headless: true });
    await closed.close();
    const observations: E2ETelemetryObservation[] = [];
    const failures: WorkspaceE2EError[] = [];
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const laneBrowser = yield* laneBrowserOver(
            closed,
            yield* openLaneSession(closed, `account-lane-${randomUUID()}`)
          );
          yield* Effect.exit(
            runE2ECase({
              body: (step) =>
                step({
                  execute: laneBrowser
                    .selectSection("profile")
                    .pipe(
                      Effect.tapError((failure) =>
                        Effect.sync(() => failures.push(failure))
                      )
                    ),
                  id: "select-profile",
                  timeoutMs: 10_000,
                }),
              caseId: "account-lane-browser",
              watchdogMs: 15_000,
            }).pipe(Effect.provide(makeE2ETelemetryMock(observations)))
          );
        })
      )
    );

    expect(
      observations
        .filter(({ scope }) => scope === "annotation")
        .map(({ scope: _scope, ...annotation }) => annotation)
    ).toEqual([
      expect.objectContaining({
        caseId: "account-lane-browser",
        failureKind: "error",
        outcome: "failed",
        stepId: "select-profile",
      }),
    ]);
    expect(failures.map(({ operation }) => operation)).toEqual([
      "open the browser context",
    ]);
  }
);
