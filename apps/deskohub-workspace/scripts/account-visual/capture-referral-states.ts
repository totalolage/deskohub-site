import { execSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  type Browser,
  type BrowserContext,
  chromium,
  expect,
  type Page,
} from "@playwright/test";
import { m } from "../../features/i18n";
import {
  assertCapturedSourcesMatchHead,
  gitStatusPorcelainLines,
} from "./capture-avatar-states";
import {
  type CheckoutVisualCapture,
  checkoutVisualCapturePlan,
  isReferralVisualScenario,
  type ReferralVisualCapture,
  type ReferralVisualScenario,
  referralVisualCaptureChecklist,
  referralVisualCapturePlan,
  referralVisualViewports,
  syntheticReferralCode,
} from "./referral-visual-fixtures";
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
import { isAccountVisualLocale } from "./types";

/**
 * From the repository root, run:
 * bun apps/deskohub-workspace/scripts/account-visual/capture-referral-states.ts --label referrals-synthetic
 */
const defaultPort = 3111;
const locales = ["en-US", "cs-CZ"] as const;
const repoRoot = resolve(import.meta.dir, "../../../..");

type CaptureOptions = {
  readonly label: string;
  readonly outputRoot: string;
  readonly port: number;
};

type ReferralActionOutcome =
  | "accepted"
  | "already_accepted"
  | "self_referral"
  | "already_attributed"
  | "ineligible"
  | "unavailable";

export const parseReferralCaptureArgs = (
  argv: readonly string[],
  configuredPort = process.env.WORKSPACE_ACCOUNT_VISUAL_PORT
): CaptureOptions => {
  let label: string | undefined;
  let outputRoot = defaultOutputRoot;
  let port = Number(configuredPort ?? defaultPort);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--label") label = argv[++index];
    else if (argument === "--output") outputRoot = argv[++index] ?? outputRoot;
    else if (argument === "--port") port = Number(argv[++index] ?? defaultPort);
    else throw new Error(`Unknown argument: ${argument}`);
  }

  if (!label || !/^[a-z0-9][a-z0-9-]*$/.test(label)) {
    throw new Error(
      "--label is required and must contain lowercase letters, numbers, and hyphens"
    );
  }
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      "The renderer port must be an integer from 1 through 65535"
    );
  }

  return { label, outputRoot, port };
};

const gitHeadSha = (): string =>
  execSync("git rev-parse HEAD", { cwd: repoRoot }).toString().trim();

const setReferralOutcome = async (
  page: Page,
  outcome: ReferralActionOutcome
) => {
  await page.evaluate((value) => {
    (
      globalThis as typeof globalThis & {
        __accountVisualReferralOutcome?: string;
      }
    ).__accountVisualReferralOutcome = value;
  }, outcome);
};

const setClipboardOutcome = async (
  page: Page,
  outcome: "success" | "failure"
) => {
  await page.evaluate((value) => {
    let writeCount = 0;
    let includedSyntheticCode = false;
    Object.defineProperty(globalThis, "__accountVisualClipboardResult", {
      configurable: true,
      value: () => ({ writeCount, includedSyntheticCode }),
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          writeCount += 1;
          includedSyntheticCode = text.includes("RFL12345");
          if (value === "failure")
            throw new Error("synthetic clipboard failure");
        },
      },
    });
  }, outcome);
};

const captureMasks = (page: Page) => [
  page.locator("[data-screen='referrals-screen'] code"),
  page.locator("[data-screen='referrals-screen'] a[href*='ref=']"),
  page.locator("#checkout-discount-code"),
];

const screenshot = async (
  page: Page,
  outputDirectory: string,
  capture: ReferralVisualCapture | CheckoutVisualCapture
) => {
  const file = join(outputDirectory, capture.filename);
  await page
    .locator("main")
    .first()
    .screenshot({
      animations: "disabled",
      mask: captureMasks(page),
      maskColor: "#6b7280",
      path: file,
    });
  return {
    filename: capture.filename,
    locale: capture.locale,
    scenario: capture.scenario,
    viewport: capture.viewport.name,
  };
};

const referralStatusMessage = (
  scenario: ReferralVisualScenario,
  locale: (typeof locales)[number]
) => {
  switch (scenario) {
    case "accepted":
      return m.accountReferralsAccepted({}, { locale });
    case "already-accepted":
      return m.accountReferralsAlreadyAccepted({}, { locale });
    case "self-referral":
      return m.accountReferralsSelfReferral({}, { locale });
    case "already-attributed":
      return m.accountReferralsAlreadyAttributed({}, { locale });
    case "ineligible":
      return m.accountReferralsIneligible({}, { locale });
    case "unavailable":
      return m.accountReferralsUnavailable({}, { locale });
    default:
      return undefined;
  }
};

const actionOutcomeForScenario = (
  scenario: ReferralVisualScenario
): ReferralActionOutcome => {
  switch (scenario) {
    case "accepted":
      return "accepted";
    case "already-accepted":
      return "already_accepted";
    case "self-referral":
      return "self_referral";
    case "already-attributed":
      return "already_attributed";
    case "ineligible":
      return "ineligible";
    case "unavailable":
      return "unavailable";
    default:
      return "unavailable";
  }
};

const assertAndCaptureReferral = async (
  page: Page,
  capture: ReferralVisualCapture,
  outputDirectory: string
) => {
  const { locale, scenario } = capture;
  const referrals = page.locator("[data-screen='referrals-screen']");
  await expect(referrals).toBeVisible();

  if (scenario === "summary-unavailable") {
    await expect(referrals.getByRole("status")).toHaveText(
      m.accountReferralsSummaryUnavailable({}, { locale })
    );
  } else if (scenario === "copy-success" || scenario === "copy-failure") {
    const copyButton = page.getByRole("button", {
      name: m.accountReferralsCopyLink({}, { locale }),
    });
    await expect(copyButton).toBeVisible();
    await setClipboardOutcome(
      page,
      scenario === "copy-success" ? "success" : "failure"
    );
    await copyButton.click();

    if (scenario === "copy-success") {
      await expect(
        page.getByRole("button", {
          name: m.accountReferralsCopied({}, { locale }),
        })
      ).toBeVisible();
      const clipboardResult = await page.evaluate(() =>
        (
          globalThis as typeof globalThis & {
            __accountVisualClipboardResult?: () => {
              readonly writeCount: number;
              readonly includedSyntheticCode: boolean;
            };
          }
        ).__accountVisualClipboardResult?.()
      );
      expect(clipboardResult).toEqual({
        writeCount: 1,
        includedSyntheticCode: true,
      });
    } else {
      await expect(referrals.getByRole("status")).toHaveText(
        m.accountReferralsCopyUnavailable({}, { locale })
      );
    }
  } else if (scenario === "invitation-eligible") {
    await expect(
      referrals.getByRole("heading", {
        name: m.accountReferralsInvitationTitle({}, { locale }),
      })
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: m.accountReferralsAccept({}, { locale }),
      })
    ).toBeEnabled();
    await expect(referrals.getByRole("status")).toHaveCount(0);
  } else {
    const expectedMessage = referralStatusMessage(scenario, locale);
    if (expectedMessage === undefined) {
      throw new Error(
        `Missing expected copy for fixed referral state ${scenario}`
      );
    }
    await setReferralOutcome(page, actionOutcomeForScenario(scenario));
    await page
      .getByRole("button", { name: m.accountReferralsAccept({}, { locale }) })
      .click();
    await expect(referrals.getByRole("status")).toHaveText(expectedMessage);
    if (scenario === "accepted" || scenario === "already-accepted") {
      await expect(
        page.getByRole("button", {
          name: m.accountReferralsAccept({}, { locale }),
        })
      ).toBeDisabled();
    }
  }

  return screenshot(page, outputDirectory, capture);
};

const assertAndCaptureCheckout = async (
  page: Page,
  capture: CheckoutVisualCapture,
  outputDirectory: string
) => {
  const form = page.locator("#checkout-discount-code-form");
  await expect(form).toBeVisible();
  await expect(page.locator("#checkout-discount-code")).toBeVisible();
  await expect(form.getByRole("alert")).toHaveText(
    m.checkoutDiscountCodeUnavailable({}, { locale: capture.locale })
  );
  await expect(
    form.getByRole("button", {
      name: m.checkoutDiscountCodeApply({}, { locale: capture.locale }),
    })
  ).toBeEnabled();
  const checkoutActionCalls = await page.evaluate(
    () =>
      (
        globalThis as typeof globalThis & {
          __accountVisualCheckoutActionCalls?: number;
        }
      ).__accountVisualCheckoutActionCalls ?? 0
  );
  expect(checkoutActionCalls).toBe(0);
  return screenshot(page, outputDirectory, capture);
};

const buildAdapter = async (
  outputDirectory: string,
  adapterFilename: string,
  locale: (typeof locales)[number]
) => {
  const runDirectory = join(
    outputDirectory,
    "bundles",
    `${adapterFilename.replace(/[^a-z-]/g, "-")}-${locale}`
  );
  await mkdir(runDirectory, { recursive: true });
  try {
    return await buildBundle(
      runDirectory,
      resolve(import.meta.dir, adapterFilename),
      locale
    );
  } finally {
    await rm(buildEntryPathForRun(runDirectory), { force: true });
  }
};

const renderBundleCaptures = async ({
  adapterFilename,
  browser,
  captures,
  captureOutputDirectory,
  locale,
  port,
  problems,
  setScenario,
}: {
  readonly adapterFilename: string;
  readonly browser: Browser;
  readonly captures: readonly (ReferralVisualCapture | CheckoutVisualCapture)[];
  readonly captureOutputDirectory: string;
  readonly locale: (typeof locales)[number];
  readonly port: number;
  readonly problems: BrowserProblem[];
  readonly setScenario: (page: Page, scenario: string) => Promise<void>;
}) => {
  const bundle = await buildAdapter(
    captureOutputDirectory,
    adapterFilename,
    locale
  );
  const rendererCss = await readFile(rendererCssPath);
  const regularFont = await readFile(fontPaths.regular);
  const italicFont = await readFile(fontPaths.italic);
  const server = await makeStaticServer(
    bundle.javascriptPath,
    bundle.cssPath,
    rendererCss,
    regularFont,
    italicFont,
    locale,
    port
  );
  const results: Array<{
    readonly filename: string;
    readonly locale: (typeof locales)[number];
    readonly scenario: ReferralVisualScenario | "checkout-code-unavailable";
    readonly viewport: "desktop" | "mobile";
  }> = [];

  try {
    for (const viewport of referralVisualViewports) {
      const context: BrowserContext = await createContext(
        browser,
        server.baseUrl,
        problems,
        { width: viewport.width, height: viewport.height },
        viewport.deviceScaleFactor,
        locale
      );
      try {
        for (const capture of captures.filter(
          ({ locale: captureLocale, viewport: captureViewport }) =>
            captureViewport.name === viewport.name && captureLocale === locale
        )) {
          const invitationQuery =
            isReferralVisualScenario(capture.scenario) &&
            capture.scenario !== "summary-unavailable" &&
            capture.scenario !== "copy-success" &&
            capture.scenario !== "copy-failure"
              ? `&ref=${syntheticReferralCode}`
              : "";
          const page = await loadRendererPage(
            context,
            server.baseUrl,
            "profile",
            problems,
            `screen=profile&section=referrals${invitationQuery}`
          );
          try {
            await setScenario(page, capture.scenario);
            if (isReferralVisualScenario(capture.scenario)) {
              results.push(
                await assertAndCaptureReferral(
                  page,
                  capture as ReferralVisualCapture,
                  captureOutputDirectory
                )
              );
            } else {
              results.push(
                await assertAndCaptureCheckout(
                  page,
                  capture as CheckoutVisualCapture,
                  captureOutputDirectory
                )
              );
            }
          } catch {
            throw new Error(
              `Synthetic visual assertion failed for ${capture.scenario}/${capture.viewport.name}/${capture.locale}`
            );
          } finally {
            await page.close();
          }
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await server.server.stop(true);
  }

  return { bundleInputs: bundle.manifest.bundleInputs, captures: results };
};

const main = async () => {
  const options = parseReferralCaptureArgs(Bun.argv.slice(2));
  assertCapturedSourcesMatchHead(gitStatusPorcelainLines());
  const outputDirectory = await makeUniqueRunDirectory(
    options.outputRoot,
    options.label
  );
  const captureOutputDirectory = join(outputDirectory, "synthetic-rendered");
  await mkdir(captureOutputDirectory, { recursive: true });
  const sha = gitHeadSha();
  const problems: BrowserProblem[] = [];
  const browser = await chromium.launch({ headless: true });
  const browserVersion = browser.version();
  const captures = [
    ...referralVisualCapturePlan(),
    ...checkoutVisualCapturePlan(),
  ];
  const results = [];
  const bundleInputs = [];

  process.stdout.write(
    `[referral-visual-capture] capturing ${captures.length} synthetic component states from commit ${sha}\n`
  );

  try {
    for (const locale of locales) {
      if (!isAccountVisualLocale(locale)) {
        throw new Error(`Invalid locale configured for capture: ${locale}`);
      }
      const referralResult = await renderBundleCaptures({
        adapterFilename: "referral-screen-adapter.tsx",
        browser,
        captures: referralVisualCapturePlan([locale]).filter(
          ({ scenario }) => scenario !== "summary-unavailable"
        ),
        captureOutputDirectory,
        locale,
        port: options.port,
        problems,
        setScenario: (page, scenario) =>
          setReferralOutcome(
            page,
            scenario === "accepted" ||
              scenario === "already-accepted" ||
              scenario === "self-referral" ||
              scenario === "already-attributed" ||
              scenario === "ineligible"
              ? actionOutcomeForScenario(scenario)
              : "unavailable"
          ),
      });
      results.push(...referralResult.captures);
      bundleInputs.push({
        locale,
        adapter: "referral-screen-adapter.tsx",
        files: referralResult.bundleInputs,
      });

      const unavailableCapture = referralVisualCapturePlan([locale]).filter(
        ({ scenario }) => scenario === "summary-unavailable"
      );
      const unavailableResult = await renderBundleCaptures({
        adapterFilename: "referral-summary-unavailable-adapter.tsx",
        browser,
        captures: unavailableCapture,
        captureOutputDirectory,
        locale,
        port: options.port,
        problems,
        setScenario: (page) => setReferralOutcome(page, "unavailable"),
      });
      results.push(...unavailableResult.captures);
      bundleInputs.push({
        locale,
        adapter: "referral-summary-unavailable-adapter.tsx",
        files: unavailableResult.bundleInputs,
      });

      const checkoutResult = await renderBundleCaptures({
        adapterFilename: "checkout-code-unavailable-adapter.tsx",
        browser,
        captures: checkoutVisualCapturePlan([locale]),
        captureOutputDirectory,
        locale,
        port: options.port,
        problems,
        setScenario: async () => undefined,
      });
      results.push(...checkoutResult.captures);
      bundleInputs.push({
        locale,
        adapter: "checkout-code-unavailable-adapter.tsx",
        files: checkoutResult.bundleInputs,
      });
    }
  } finally {
    await browser.close();
  }

  if (gitHeadSha() !== sha) {
    throw new Error(`HEAD moved during capture from ${sha}`);
  }
  assertCapturedSourcesMatchHead(gitStatusPorcelainLines());
  if (results.length !== referralVisualCaptureChecklist.totalCaptureCount) {
    throw new Error(
      `Expected ${referralVisualCaptureChecklist.totalCaptureCount} fixed captures, received ${results.length}`
    );
  }

  const report = {
    schemaVersion: 1,
    capturedFromCommit: sha,
    browserVersion,
    evidenceType: referralVisualCaptureChecklist.evidenceType,
    excludedLocalStatusPath: "apps/deskohub-workspace/.env.example",
    fixture:
      "synthetic only; no real account, provider, reservation, or payment data",
    coverage: referralVisualCaptureChecklist,
    bundleInputs,
    captures: results,
    problems: problems.map(({ kind }) => ({ kind })),
  };
  const reportPath = join(
    captureOutputDirectory,
    "synthetic-referral-states-report.json"
  );
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(
    `[referral-visual-capture] wrote ${results.length} masked PNGs and ${reportPath}\n`
  );
  if (problems.length > 0) {
    process.stderr.write(
      `[referral-visual-capture] browser problems: ${JSON.stringify(problems.map(({ kind }) => kind))}\n`
    );
    process.exitCode = 1;
  }
};

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : "Synthetic referral capture failed"}\n`
    );
    process.exitCode = 1;
  }
}
