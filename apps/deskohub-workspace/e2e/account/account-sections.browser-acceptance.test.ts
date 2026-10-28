import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { type Browser, chromium } from "@playwright/test";
import { Effect } from "effect";
import { getAccountSectionPath } from "@/features/account/routes";
import type { AccountSection } from "@/features/account/sections";
import { m } from "@/features/i18n";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { E2EBrowserSession } from "../browser-session";
import { runE2ECase } from "../case-runner";
import { isWorkspaceE2ETimeout, type WorkspaceE2EError } from "../errors";
import {
  type E2ETelemetryObservation,
  makeE2ETelemetryMock,
} from "../services/telemetry.mock";
import { workspaceE2ETimeouts } from "../timeouts";
import {
  accountSectionLandmarks,
  selectAccountSectionInSession,
} from "./account-sections";
import { buildAccountSectionsHarness } from "./account-sections.browser-harness.test-utils";

// The account lane selects sections in a real, hydrated AccountShell, so
// these drive the session helper against one in Chromium.
const chromiumAvailable = await playwrightChromiumAvailable();
const navigationLabel = m.accountNavigationLabel({}, { locale: "en-US" });
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

type SectionClick = { readonly href: string | null; readonly mobile: boolean };

/** Opens the harness in a session and records every section-link click. */
const openAccountSections = (viewport?: {
  readonly height: number;
  readonly width: number;
}) =>
  Effect.gen(function* () {
    if (!browser) throw new Error("Chromium is not running");
    const session = yield* E2EBrowserSession.open({
      browser,
      id: `account-sections-${randomUUID()}`,
      recordHar: false,
    });
    yield* session.use("open the account sections harness", async (page) => {
      if (viewport) await page.setViewportSize(viewport);
      await page.setContent(
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="account-sections-test-root"></div></body></html>'
      );
      await page.addStyleTag({ content: harness.styles });
      await page.addScriptTag({ content: harness.script });
      await page.getByRole("navigation", { name: navigationLabel }).waitFor();
      await page.evaluate(() => {
        const clicks: { href: string | null; mobile: boolean }[] = [];
        Reflect.set(window, "__sectionClicks", clicks);
        document.addEventListener(
          "click",
          (event) => {
            const link =
              event.target instanceof Element
                ? event.target.closest("a")
                : null;
            if (!link) return;
            clicks.push({
              href: link.getAttribute("href"),
              mobile: link.closest("[data-account-mobile-navigation]") !== null,
            });
          },
          true
        );
      });
    });
    return session;
  });

const readSelection = (session: E2EBrowserSession, section: AccountSection) =>
  session.evaluate(
    "read the selected account section",
    ({ landmark }) => {
      const isRendered = (element: Element | null) => {
        const rect = element?.getBoundingClientRect();
        return rect !== undefined && rect.width > 0 && rect.height > 0;
      };
      return {
        clicks: Reflect.get(window, "__sectionClicks") as SectionClick[],
        currentHrefs: Array.from(
          document.querySelectorAll('nav a[aria-current="page"]')
        )
          .filter(isRendered)
          .map((link) => link.getAttribute("href")),
        landmarkRendered: isRendered(document.querySelector(landmark)),
      };
    },
    { landmark: accountSectionLandmarks[section] }
  );

test.skipIf(!chromiumAvailable)(
  "selects sections through the visible desktop navigation",
  async () => {
    const selections = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const session = yield* openAccountSections();
          const results = [];
          for (const section of [
            "profile",
            "billing",
            "legal",
            "danger",
          ] as const) {
            yield* selectAccountSectionInSession(session, section);
            results.push({
              section,
              ...(yield* readSelection(session, section)),
            });
          }
          return results;
        })
      )
    );

    for (const {
      clicks,
      currentHrefs,
      landmarkRendered,
      section,
    } of selections) {
      expect(currentHrefs).toEqual([getAccountSectionPath("en-US", section)]);
      expect(landmarkRendered).toBe(true);
      expect(clicks.at(-1)).toEqual({
        href: getAccountSectionPath("en-US", section),
        mobile: false,
      });
    }
  }
);

test.skipIf(!chromiumAvailable)(
  "selects sections through the visible mobile navigation",
  async () => {
    const selections = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const session = yield* openAccountSections({
            height: 844,
            width: 390,
          });
          const results = [];
          for (const section of ["billing", "profile"] as const) {
            yield* selectAccountSectionInSession(session, section);
            results.push({
              section,
              ...(yield* readSelection(session, section)),
            });
          }
          return results;
        })
      )
    );

    for (const {
      clicks,
      currentHrefs,
      landmarkRendered,
      section,
    } of selections) {
      expect(currentHrefs).toEqual([getAccountSectionPath("en-US", section)]);
      expect(landmarkRendered).toBe(true);
      expect(clicks.at(-1)).toEqual({
        href: getAccountSectionPath("en-US", section),
        mobile: true,
      });
    }
  }
);

test.skipIf(!chromiumAvailable)(
  "starts no click after a step deadline stops a selection waiting for hydration",
  async () => {
    const observations: E2ETelemetryObservation[] = [];
    const failures: WorkspaceE2EError[] = [];
    const after = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const session = yield* openAccountSections();
          // A streamed server copy carries no React props until hydration,
          // as the profile screen billing shares does after a document load.
          yield* session.use("hold the profile panel's hydration", (page) =>
            page.evaluate((landmark) => {
              const hydrated = document.querySelector(landmark);
              if (!hydrated) throw new Error("profile screen missing");
              Reflect.set(window, "__hydratedProfile", hydrated);
              hydrated.replaceWith(hydrated.cloneNode(true));
            }, accountSectionLandmarks.profile)
          );
          yield* Effect.exit(
            runE2ECase({
              body: (step) =>
                step({
                  execute: selectAccountSectionInSession(
                    session,
                    "billing"
                  ).pipe(
                    Effect.tapError((failure) =>
                      Effect.sync(() => failures.push(failure))
                    )
                  ),
                  id: "select-billing",
                  timeoutMs: 1000,
                }),
              caseId: "account-sections",
              watchdogMs: 6000,
            }).pipe(Effect.provide(makeE2ETelemetryMock(observations)))
          );
          yield* session.use("finish the profile panel's hydration", (page) =>
            page.evaluate((landmark) => {
              const hydrated = Reflect.get(window, "__hydratedProfile");
              if (!(hydrated instanceof Element))
                throw new Error("hydrated profile screen missing");
              document.querySelector(landmark)?.replaceWith(hydrated);
            }, accountSectionLandmarks.profile)
          );
          // Longer than the hydration poll, so a leftover click would land.
          yield* Effect.sleep("1500 millis");
          return yield* readSelection(session, "billing");
        })
      )
    );

    expect(
      observations
        .filter(({ scope }) => scope === "annotation")
        .map(({ scope: _scope, ...annotation }) => annotation)
    ).toEqual([
      expect.objectContaining({
        caseId: "account-sections",
        failureKind: "timeout",
        outcome: "timed_out",
        stepId: "select-billing",
      }),
    ]);
    expect(failures).toEqual([]);
    expect(after.clicks).toEqual([]);
    expect(after.currentHrefs).toEqual([
      getAccountSectionPath("en-US", "reservations"),
    ]);
  }
);

/**
 * Selects `section` as the one step of a case, with a step deadline beyond
 * the selection's own browser-action bounds, and returns the annotations and
 * the step's failures as the reporter would see them.
 */
const runBoundedSelection = (
  session: E2EBrowserSession,
  section: AccountSection,
  caseId: string
) =>
  Effect.gen(function* () {
    const observations: E2ETelemetryObservation[] = [];
    const failures: WorkspaceE2EError[] = [];
    yield* Effect.exit(
      runE2ECase({
        body: (step) =>
          step({
            execute: selectAccountSectionInSession(session, section).pipe(
              Effect.tapError((failure) =>
                Effect.sync(() => failures.push(failure))
              )
            ),
            id: "select-section",
            timeoutMs: workspaceE2ETimeouts.browserAction + 10_000,
          }),
        caseId,
        watchdogMs: workspaceE2ETimeouts.browserAction + 20_000,
      }).pipe(Effect.provide(makeE2ETelemetryMock(observations)))
    );
    return {
      annotations: observations
        .filter(({ scope }) => scope === "annotation")
        .map(({ scope: _scope, ...annotation }) => annotation),
      failures: failures.map((failure) => ({
        operation: failure.operation,
        timeout: isWorkspaceE2ETimeout(failure),
      })),
    };
  });

// Both cases wait out a full browser action, so they run side by side; the
// test allows for the watchdog and each Scope's bounded session close.
test.skipIf(!chromiumAvailable)(
  "fails an overrunning viewport read and times out a blocked section click",
  async () => {
    const [viewport, click] = await Effect.runPromise(
      Effect.all(
        [
          Effect.scoped(
            Effect.gen(function* () {
              const session = yield* openAccountSections();
              // The read's own bound passes before the page answers.
              yield* session.use("stall the viewport read", (page) =>
                page.evaluate((stallMs) => {
                  const matchMedia = window.matchMedia.bind(window);
                  window.matchMedia = (query) => {
                    const until = Date.now() + stallMs;
                    while (Date.now() < until) {
                      // Holds the page's thread past the read's bound.
                    }
                    return matchMedia(query);
                  };
                }, workspaceE2ETimeouts.browserAction + 1000)
              );
              const result = yield* runBoundedSelection(
                session,
                "billing",
                "account-sections-viewport"
              );
              return {
                ...result,
                after: yield* readSelection(session, "billing"),
              };
            })
          ),
          Effect.scoped(
            Effect.gen(function* () {
              const session = yield* openAccountSections();
              // A layer over the page takes every pointer event, so the
              // visible link never becomes clickable.
              yield* session.use("cover the account navigation", (page) =>
                page.evaluate(() => {
                  const cover = document.createElement("div");
                  cover.style.cssText =
                    "position:fixed;inset:0;z-index:2147483647";
                  document.body.append(cover);
                })
              );
              const result = yield* runBoundedSelection(
                session,
                "billing",
                "account-sections-click"
              );
              return {
                ...result,
                after: yield* readSelection(session, "billing"),
              };
            })
          ),
        ],
        { concurrency: "unbounded" }
      )
    );

    expect(viewport.annotations).toEqual([
      expect.objectContaining({
        caseId: "account-sections-viewport",
        failureKind: "error",
        outcome: "failed",
        stepId: "select-section",
      }),
    ]);
    expect(viewport.failures).toEqual([
      { operation: "read account navigation viewport mode", timeout: false },
    ]);
    expect(viewport.after.clicks).toEqual([]);

    expect(click.annotations).toEqual([
      expect.objectContaining({
        caseId: "account-sections-click",
        failureKind: "timeout",
        outcome: "timed_out",
        stepId: "select-section",
      }),
    ]);
    expect(click.failures).toEqual([
      { operation: "click account billing section link", timeout: true },
    ]);
    expect(click.after.clicks).toEqual([]);
    expect(click.after.currentHrefs).toEqual([
      getAccountSectionPath("en-US", "reservations"),
    ]);
  },
  workspaceE2ETimeouts.browserAction * 2 + 25_000
);
