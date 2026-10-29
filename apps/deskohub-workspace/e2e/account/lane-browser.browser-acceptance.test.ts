import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { type Browser, chromium } from "@playwright/test";
import { Effect } from "effect";
import { getAccountSectionPath } from "@/features/account/routes";
import { sharedReferralCodeRememberedDays } from "@/features/referrals/program";
import { referralCodeCookieName } from "@/features/referrals/referral-code-cookie";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { runE2ECase } from "../case-runner";
import { isWorkspaceE2ETimeout, type WorkspaceE2EError } from "../errors";
import {
  browserSessionFor,
  makePlaywrightBrowserRunner,
  type Runner,
} from "../runtime";
import {
  type E2ETelemetryObservation,
  makeE2ETelemetryMock,
} from "../services/telemetry.mock";
import { workspaceE2ETimeouts } from "../timeouts";
import { buildAccountSectionsHarness } from "./account-sections.browser-harness.test-utils";
import { makeWorkspaceE2EAccountLaneBrowser } from "./lane-browser";

// The account cases drive these steps on the page their argv commands
// opened, so each runs here through the real runner's session for the lane.
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
  Effect.runPromise(
    effect.pipe(
      Effect.match({
        onFailure: (failure) => ({
          operation: failure.operation,
          timeout: isWorkspaceE2ETimeout(failure),
        }),
        onSuccess: () => "succeeded" as const,
      })
    )
  );

/**
 * Serves the account page inside the lane session's context: the hydrated
 * AccountShell, which remembers a `?ref=` code the way a shared link does.
 */
const serveAccountPage = (run: Runner, session: string) =>
  Effect.runPromise(
    Effect.flatMap(browserSessionFor(run, session), (laneSession) =>
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
    )
  );

const argv = async (
  run: Runner,
  session: string,
  args: string[],
  input?: string
) =>
  (
    await run("playwright", ["--session", session, ...args], {
      input,
      logCommand: false,
      logOutput: false,
      timeoutMs: 15_000,
    })
  ).stdout;

test.skipIf(!chromiumAvailable)(
  "drives the page the lane's argv commands opened",
  async () => {
    if (!browser) throw new Error("Chromium is not running");
    const run = makePlaywrightBrowserRunner(browser, { recordHar: false });
    const session = `account-lane-${randomUUID()}`;
    const fresh = `account-lane-fresh-${randomUUID()}`;
    const laneBrowser = makeWorkspaceE2EAccountLaneBrowser({
      config,
      run,
      session,
    });
    try {
      await serveAccountPage(run, session);
      await argv(run, session, [
        "open",
        `${origin}/en-US/account?ref=${sharedCode}`,
      ]);
      await Effect.runPromise(
        laneBrowser.waitForRememberedReferralCode(sharedCode)
      );
      // The waits read this lane's cookie for the code they were given.
      const [otherCodeWait, absentCodeWait] = await Promise.all([
        failureOf(laneBrowser.waitForRememberedReferralCode(otherCode)),
        failureOf(laneBrowser.waitForNoRememberedReferralCode),
      ]);
      await Effect.runPromise(laneBrowser.selectSection("billing"));
      const selected = await argv(
        run,
        session,
        ["eval", "--stdin"],
        `Array.from(document.querySelectorAll('nav a[aria-current="page"]')).filter((link) => link.getBoundingClientRect().width > 0).map((link) => link.getAttribute("href")).join(" ")`
      );
      // Another lane session is another context, which remembers nothing.
      await argv(run, fresh, ["open", "about:blank"]);
      await Effect.runPromise(
        makeWorkspaceE2EAccountLaneBrowser({
          config,
          run,
          session: fresh,
        }).waitForNoRememberedReferralCode
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
    } finally {
      await run.close?.();
    }
  }
);

test.skipIf(!chromiumAvailable)(
  "fails the calling step when the lane browser cannot open",
  async () => {
    const closed = await chromium.launch({ headless: true });
    await closed.close();
    const run = makePlaywrightBrowserRunner(closed, { recordHar: false });
    const laneBrowser = makeWorkspaceE2EAccountLaneBrowser({
      config,
      run,
      session: `account-lane-${randomUUID()}`,
    });
    const observations: E2ETelemetryObservation[] = [];
    const failures: WorkspaceE2EError[] = [];
    try {
      await Effect.runPromise(
        Effect.exit(
          runE2ECase({
            body: (step) =>
              step({
                execute: laneBrowser.selectSection("profile").pipe(
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
        )
      );
    } finally {
      await run.close?.();
    }

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
