import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, chromium } from "@playwright/test";
import { Effect } from "effect";
import { getAccountSectionPath } from "@/features/account/routes";
import type { AccountSection } from "@/features/account/sections";
import { m } from "@/features/i18n";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { compileWorkspaceAppStyles } from "@/shared/testing/workspace-app-styles.test-utils";
import { E2EBrowserSession } from "../browser-session";
import { runE2ECase } from "../case-runner";
import type { WorkspaceE2EError } from "../errors";
import {
  type E2ETelemetryObservation,
  makeE2ETelemetryMock,
} from "../services/telemetry.mock";
import {
  accountSectionLandmarks,
  selectAccountSectionInSession,
} from "./account-sections";

// The account lane selects sections in a real, hydrated AccountShell, so
// these drive the session helper against one in Chromium.
const chromiumAvailable = await playwrightChromiumAvailable();
const navigationLabel = m.accountNavigationLabel({}, { locale: "en-US" });
let browser: Browser | undefined;
let buildDirectory = "";
let harnessBundlePath = "";
let appStyles = "";

beforeAll(async () => {
  if (!chromiumAvailable) return;
  buildDirectory = await mkdtemp(join(tmpdir(), "account-sections-browser-"));
  const build = await Bun.build({
    entrypoints: [
      join(import.meta.dir, "account-sections.browser-harness.tsx"),
    ],
    format: "iife",
    minify: true,
    naming: "account-sections-harness.js",
    outdir: buildDirectory,
    target: "browser",
  });
  if (!build.success) {
    throw new Error(build.logs.map(({ message }) => message).join("\n"));
  }
  harnessBundlePath = join(buildDirectory, "account-sections-harness.js");
  appStyles = await compileWorkspaceAppStyles();
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
  if (buildDirectory)
    await rm(buildDirectory, { force: true, recursive: true });
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
      await page.addStyleTag({ content: appStyles });
      await page.addScriptTag({ path: harnessBundlePath });
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
