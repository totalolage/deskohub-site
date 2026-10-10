import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  type Browser,
  type BrowserContext,
  chromium,
  expect,
} from "@playwright/test";
import { m } from "../../features/i18n";
import { commandOutput } from "../shared/command";
import {
  type BrowserProblem,
  buildBundle,
  buildEntryPathForRun,
  createContext,
  defaultOutputRoot,
  fontPaths,
  loadRendererPage,
  makeStaticServer,
  makeUniqueRunDirectory,
  rendererCssPath,
} from "./run";
import { type AccountVisualLocale, isAccountVisualLocale } from "./types";

/**
 * Captures the ARES business-lookup UI states of the account profile form from
 * the exact committed implementation, using only the harness's synthetic
 * fixture company. Never contacts the real ARES registry: the lookup action is
 * the harness's controllable stub in `stubs/account-actions.ts`.
 *
 * Usage:
 *   bun apps/deskohub-workspace/scripts/account-visual/capture-ares-states.ts --label ares-evidence
 */

const desktopCssWidth = 1280;
const desktopCssHeight = 2400;
const desktopDeviceScaleFactor = 2;
const defaultPort = 3111;
const syntheticIco = "27082440";
const syntheticCompanyName = "Vzorková s.r.o.";
const locales: readonly AccountVisualLocale[] = ["en-US", "cs-CZ"];

type AresStateId =
  | "idle"
  | "loading"
  | "found"
  | "applied"
  | "invalid"
  | "not-found"
  | "unavailable";

const outcomeByState: Partial<Record<AresStateId, string>> = {
  loading: "loading",
  found: "found",
  applied: "found",
  invalid: "invalid-ico",
  "not-found": "not-found",
  unavailable: "unavailable",
};

const gitHeadSha = async (): Promise<string> =>
  (
    await commandOutput(["git", "rev-parse", "HEAD"], {
      cwd: resolve(import.meta.dir, "../../../.."),
    })
  ).trim();

const parseArgs = (argv: readonly string[]) => {
  let label: string | undefined;
  let outputRoot = defaultOutputRoot;
  let port = defaultPort;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--label") label = argv[++index];
    else if (argument === "--output") outputRoot = argv[++index] ?? outputRoot;
    else if (argument === "--port") port = Number(argv[++index] ?? defaultPort);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!label) throw new Error("--label is required");
  return { label, outputRoot, port };
};

const statusRegionText = async (page: import("@playwright/test").Page) =>
  (await page.locator("#account-profile-ares-status").innerText()).trim();

const selectBusinessBilling = async (page: import("@playwright/test").Page) => {
  await page.locator("#account-profile-billing-kind").selectOption("business");
  await expect(
    page.locator("#account-profile-billing-company-id")
  ).toBeVisible();
};

const setOutcome = async (
  page: import("@playwright/test").Page,
  outcome: string
) => {
  await page.evaluate((value) => {
    (
      globalThis as typeof globalThis & { __accountVisualAresOutcome?: string }
    ).__accountVisualAresOutcome = value;
  }, outcome);
};

/**
 * The lookup control is the only button in the flex row directly above the
 * live region; its accessible name changes between submit, loading, and retry
 * labels, so selection is structural rather than name-based.
 */
const lookupControl = (page: import("@playwright/test").Page) =>
  page.locator(
    "//p[@id='account-profile-ares-status']/preceding-sibling::div[1]/button"
  );

/**
 * The pending "loading" stub promise never resolves, so `isExecuting` stays
 * true for the page's lifetime; every lookup state therefore opens a fresh
 * renderer page instead of resetting in place.
 */
const openBillingPage = async (
  context: BrowserContext,
  baseUrl: string,
  problems: BrowserProblem[]
) => {
  const page = await loadRendererPage(
    context,
    baseUrl,
    "billing",
    problems,
    "screen=billing&section=billing"
  );
  await selectBusinessBilling(page);
  return page;
};

const runLocale = async ({
  browser,
  outputDirectory,
  locale,
  port,
  problems,
}: {
  readonly browser: Browser;
  readonly outputDirectory: string;
  readonly locale: AccountVisualLocale;
  readonly port: number;
  readonly problems: BrowserProblem[];
}) => {
  const runDirectory = join(outputDirectory, `bundle-${locale}`);
  await mkdir(runDirectory, { recursive: true });
  let bundle: Awaited<ReturnType<typeof buildBundle>>;
  try {
    bundle = await buildBundle(
      runDirectory,
      resolve(import.meta.dir, "default-adapter.tsx"),
      locale
    );
  } finally {
    await rm(buildEntryPathForRun(runDirectory), { force: true });
  }
  const rendererCss = await readFile(rendererCssPath);
  const regularFont = await readFile(fontPaths.regular);
  const italicFont = await readFile(fontPaths.italic);
  const staticServer = await makeStaticServer(
    bundle.javascriptPath,
    bundle.cssPath,
    rendererCss,
    regularFont,
    italicFont,
    locale,
    port
  );
  const stateResults: unknown[] = [];
  try {
    const context: BrowserContext = await createContext(
      browser,
      staticServer.baseUrl,
      problems,
      { width: desktopCssWidth, height: desktopCssHeight },
      desktopDeviceScaleFactor,
      locale
    );
    let page = await openBillingPage(context, staticServer.baseUrl, problems);

    const captureState = async (stateId: AresStateId) => {
      const file = join(outputDirectory, `ares-${stateId}-${locale}.png`);
      const main = page.locator("main").first();
      await main.screenshot({ path: file, animations: "disabled" });
      return { stateId, locale, file };
    };

    // 1. idle: control beside the IČO field, no status, no panel.
    {
      const expected = "";
      const actual = await statusRegionText(page);
      expect(actual).toBe(expected);
      await expect(lookupControl(page)).toBeEnabled();
      stateResults.push({
        ...(await captureState("idle")),
        expectedStatusText: expected,
        actualStatusText: actual,
      });
    }

    // 2. loading: never-resolving stub promise keeps the pending state stable.
    {
      page = await openBillingPage(context, staticServer.baseUrl, problems);
      await setOutcome(page, outcomeByState.loading!);
      await page.fill("#account-profile-billing-company-id", syntheticIco);
      await lookupControl(page).click();
      await expect(lookupControl(page)).toBeDisabled();
      await expect(
        page.getByRole("button", {
          name: m.accountAresLookupLoading({}, { locale }),
        })
      ).toBeVisible();
      const actual = await statusRegionText(page);
      expect(actual).toBe(m.accountAresLookupLoading({}, { locale }));
      stateResults.push({
        ...(await captureState("loading")),
        expectedStatusText: actual,
        actualStatusText: actual,
      });
    }

    // 3. found: review panel with the synthetic previewed company.
    {
      page = await openBillingPage(context, staticServer.baseUrl, problems);
      await setOutcome(page, outcomeByState.found!);
      await page.fill("#account-profile-billing-company-id", syntheticIco);
      await lookupControl(page).click();
      await expect(
        page.getByText(m.accountAresLookupReviewTitle({}, { locale }))
      ).toBeVisible();
      await expect(page.getByText(syntheticCompanyName)).toBeVisible();
      const actual = await statusRegionText(page);
      expect(actual).toBe(m.accountAresLookupReviewReady({}, { locale }));
      stateResults.push({
        ...(await captureState("found")),
        expectedStatusText: actual,
        actualStatusText: actual,
      });

      // 4. applied: fields copied into the billing draft with applied message.
      await page
        .getByRole("button", {
          name: m.accountAresLookupApply({}, { locale }),
        })
        .click();
      await expect(
        page.locator("#account-profile-billing-company-name")
      ).toHaveValue(syntheticCompanyName);
      const applied = await statusRegionText(page);
      expect(applied).toBe(m.accountAresLookupApplied({}, { locale }));
      stateResults.push({
        ...(await captureState("applied")),
        expectedStatusText: applied,
        actualStatusText: applied,
      });
    }

    // 5-7. terminal failure messages.
    for (const stateId of ["invalid", "not-found", "unavailable"] as const) {
      page = await openBillingPage(context, staticServer.baseUrl, problems);
      await setOutcome(page, outcomeByState[stateId]!);
      await page.fill("#account-profile-billing-company-id", syntheticIco);
      await lookupControl(page).click();
      const expectedMessage = (() => {
        if (stateId === "invalid")
          return m.accountAresLookupInvalidIco({}, { locale });
        if (stateId === "not-found")
          return m.accountAresLookupNotFound({}, { locale });
        return m.accountAresLookupUnavailable({}, { locale });
      })();
      await expect(page.locator("#account-profile-ares-status")).toHaveText(
        expectedMessage
      );
      const actual = await statusRegionText(page);
      stateResults.push({
        ...(await captureState(stateId)),
        expectedStatusText: expectedMessage,
        actualStatusText: actual,
      });
    }

    await context.close();
  } finally {
    await staticServer.server.stop(true);
  }
  return stateResults;
};

const main = async () => {
  const { label, outputRoot, port } = parseArgs(Bun.argv.slice(2));
  const outputDirectory = await makeUniqueRunDirectory(outputRoot, label);
  const sha = await gitHeadSha();
  process.stdout.write(
    `[ares-capture] capturing ARES lookup states from commit ${sha}\n`
  );
  const problems: BrowserProblem[] = [];
  const browser = await chromium.launch({ headless: true });
  const browserVersion = browser.version();
  const results: unknown[] = [];
  try {
    for (const locale of locales) {
      if (!isAccountVisualLocale(locale))
        throw new Error(`Invalid locale: ${locale}`);
      results.push(
        ...(await runLocale({
          browser,
          outputDirectory,
          locale,
          port,
          problems,
        }))
      );
    }
  } finally {
    await browser.close();
  }
  const report = {
    schemaVersion: 1,
    capturedFromCommit: sha,
    browserVersion,
    fixtureCompany: "synthetic only; never real ARES registry data",
    states: results,
    problems,
  };
  const reportPath = join(outputDirectory, "ares-states-report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(
    `[ares-capture] wrote ${results.length} PNGs and ${reportPath}\n`
  );
  if (problems.length > 0) {
    process.stderr.write(
      `[ares-capture] browser problems: ${JSON.stringify(problems)}\n`
    );
    process.exitCode = 1;
  }
};

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : "ARES state capture failed"}\n`
    );
    process.exitCode = 1;
  }
}
