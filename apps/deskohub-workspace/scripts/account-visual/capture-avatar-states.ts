import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import {
  type Browser,
  type BrowserContext,
  chromium,
  expect,
  type Page,
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
 * Captures the account avatar visibility boundary and its flag-on states from
 * the real profile screen. The AvatarControl is never mocked: mutation states
 * use real file-input/button interactions and the controlled synthetic action
 * stub. Hidden, fallback, pending, success, and error coverage is captured at
 * desktop, tablet, and mobile sizes in both supported locales. All fixture
 * data and avatar images are synthetic.
 *
 * Usage:
 *   WORKSPACE_ACCOUNT_VISUAL_PORT=3999 bun apps/deskohub-workspace/scripts/account-visual/capture-avatar-states.ts --label avatar-evidence
 */

const captureViewports = [
  { name: "desktop", width: 1280, height: 2400, deviceScaleFactor: 2 },
  { name: "tablet", width: 768, height: 1024, deviceScaleFactor: 1 },
  { name: "mobile", width: 375, height: 900, deviceScaleFactor: 1 },
] as const;
const defaultPort = 3111;
const locales: readonly AccountVisualLocale[] = ["en-US", "cs-CZ"];

type AvatarStateId =
  | "hidden-profile"
  | "fallback"
  | "pending-upload"
  | "uploaded"
  | "upload-error"
  | "pending-remove"
  | "removed";
type AvatarFixture = "available" | "hidden";
type CaptureViewport = (typeof captureViewports)[number];

export const avatarVisualCaptureChecklist = {
  hidden: {
    states: ["hidden-profile"],
    viewports: captureViewports.map(({ name }) => name),
    locales,
    assertions: [
      "profile identity and email remain visible",
      "no avatar image, fallback, controls, hint, or status region is mounted",
    ],
  },
  available: {
    states: [
      "fallback",
      "pending-upload",
      "uploaded",
      "upload-error",
      "pending-remove",
      "removed",
    ],
    viewports: captureViewports.map(({ name }) => name),
    locales,
    assertions: [
      "no-image state shows initials, camera, hint, and an empty status region",
      "pending, success, and error mutations preserve their localized statuses",
    ],
  },
} as const;

const repoRoot = resolve(import.meta.dir, "../../../..");

const gitHeadSha = async (): Promise<string> =>
  (await commandOutput(["git", "rev-parse", "HEAD"], { cwd: repoRoot })).trim();

/**
 * The bundle is compiled from the working tree, so any staged, unstaged, or
 * untracked difference from HEAD would make the report misattribute a dirty
 * tree to the clean commit. `--untracked-files=all` is explicit because
 * `git status` otherwise honors `status.showUntrackedFiles=no` from git
 * config and would silently hide untracked build inputs.
 */
export const gitStatusPorcelainLines = async (
  cwd: string = repoRoot
): Promise<readonly string[]> =>
  (
    await commandOutput(
      ["git", "status", "--porcelain=v1", "--untracked-files=all"],
      { cwd }
    )
  )
    .split("\n")
    .filter((line) => line.trim().length > 0);

export const assertCapturedSourcesMatchHead = (
  statusLines: readonly string[]
): void => {
  if (statusLines.length > 0) {
    throw new Error(
      `Account visual capture compiles the working tree, so it requires a tree identical to HEAD; refusing to attribute a dirty tree to a clean commit. Differences:\n${statusLines.join("\n")}`
    );
  }
};

const parseArgs = (argv: readonly string[]) => {
  let label: string | undefined;
  let outputRoot = defaultOutputRoot;
  const port = Number(process.env.WORKSPACE_ACCOUNT_VISUAL_PORT ?? defaultPort);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--label") label = argv[++index];
    else if (argument === "--output") outputRoot = argv[++index] ?? outputRoot;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!label) throw new Error("--label is required");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      `WORKSPACE_ACCOUNT_VISUAL_PORT must be a decimal integer from 1 through 65535; received ${process.env.WORKSPACE_ACCOUNT_VISUAL_PORT}`
    );
  }
  return { label, outputRoot, port };
};

const setOutcome = async (page: Page, outcome: string) => {
  await page.evaluate((value) => {
    (
      globalThis as typeof globalThis & {
        __accountVisualAvatarOutcome?: string;
      }
    ).__accountVisualAvatarOutcome = value;
  }, outcome);
};

const statusRegion = (page: Page) =>
  page.locator("[data-screen='profile-screen'] div[role='status']");

const statusRegionText = async (page: Page) =>
  (await statusRegion(page).innerText()).trim();

const cameraButton = (page: Page, locale: AccountVisualLocale) =>
  page.getByRole("button", {
    name: m.accountProfileAvatarChange({}, { locale }),
  });

const removeButton = (page: Page, locale: AccountVisualLocale) =>
  page.getByRole("button", {
    name: m.accountProfileAvatarRemove({}, { locale }),
  });

/**
 * Upload through the component's real flow: the sr-only file input's change
 * handler builds the FormData and executes the real (stubbed-boundary) Server
 * Action. The stub boundary is the only synthetic layer; the DOM interactions
 * and component handlers are production behavior.
 */
const uploadViaFileInput = async (
  page: Page,
  syntheticPng: Buffer,
  outcome: "pending-upload" | "uploaded" | "retryable-upload"
) => {
  await setOutcome(page, outcome);
  await page
    .locator("[data-screen='profile-screen'] input[type='file']")
    .setInputFiles({
      name: "synthetic-avatar.png",
      mimeType: "image/png",
      buffer: syntheticPng,
    });
};

const removeViaButton = async (
  page: Page,
  locale: AccountVisualLocale,
  outcome: "pending-remove" | "removed"
) => {
  await setOutcome(page, outcome);
  await removeButton(page, locale).click();
};

const captureAvatarState = async ({
  expectedStatusText,
  fixture,
  locale,
  outputDirectory,
  page,
  stateId,
  viewport,
}: {
  readonly expectedStatusText?: string;
  readonly fixture: AvatarFixture;
  readonly locale: AccountVisualLocale;
  readonly outputDirectory: string;
  readonly page: Page;
  readonly stateId: AvatarStateId;
  readonly viewport: CaptureViewport;
}) => {
  const file = join(
    outputDirectory,
    `avatar-${stateId}-${viewport.name}-${locale}.png`
  );
  await page.locator("main").first().screenshot({
    path: file,
    animations: "disabled",
  });
  const capture = { stateId, fixture, viewport: viewport.name, locale, file };
  if (expectedStatusText === undefined) return capture;
  return {
    ...capture,
    expectedStatusText,
    actualStatusText: await statusRegionText(page),
  };
};

const runLocale = async ({
  browser,
  outputDirectory,
  locale,
  port,
  problems,
  syntheticPng,
}: {
  readonly browser: Browser;
  readonly outputDirectory: string;
  readonly locale: AccountVisualLocale;
  readonly port: number;
  readonly problems: BrowserProblem[];
  readonly syntheticPng: Buffer;
}) => {
  const rendererCss = await readFile(rendererCssPath);
  const regularFont = await readFile(fontPaths.regular);
  const italicFont = await readFile(fontPaths.italic);
  const stateResults: unknown[] = [];
  const bundleInputs: Array<{
    readonly fixture: AvatarFixture;
    readonly bundleInputs: Awaited<
      ReturnType<typeof buildBundle>
    >["manifest"]["bundleInputs"];
  }> = [];

  const captureFixture = async (
    fixture: AvatarFixture,
    adapterFile: string
  ) => {
    const runDirectory = join(outputDirectory, `bundle-${fixture}-${locale}`);
    await mkdir(runDirectory, { recursive: true });
    let bundle: Awaited<ReturnType<typeof buildBundle>>;
    try {
      bundle = await buildBundle(
        runDirectory,
        resolve(import.meta.dir, adapterFile),
        locale
      );
    } finally {
      await rm(buildEntryPathForRun(runDirectory), { force: true });
    }

    const staticServer = await makeStaticServer(
      bundle.javascriptPath,
      bundle.cssPath,
      rendererCss,
      regularFont,
      italicFont,
      locale,
      port
    );
    try {
      for (const viewport of captureViewports) {
        const context: BrowserContext = await createContext(
          browser,
          staticServer.baseUrl,
          problems,
          { width: viewport.width, height: viewport.height },
          viewport.deviceScaleFactor,
          locale
        );
        try {
          const page = await loadRendererPage(
            context,
            staticServer.baseUrl,
            "profile",
            problems,
            "screen=profile&section=profile"
          );
          const profile = page.locator("[data-screen='profile-screen']");
          await expect(profile).toBeVisible();

          if (fixture === "hidden") {
            await expect(profile).toContainText("Ada Example");
            await expect(profile).toContainText("ada@example.test");
            await expect(profile.locator("img")).toHaveCount(0);
            await expect(profile.getByText("AE")).toHaveCount(0);
            await expect(profile.locator("input[type='file']")).toHaveCount(0);
            await expect(
              profile.locator("svg.lucide-camera, svg.lucide-user-round")
            ).toHaveCount(0);
            await expect(cameraButton(page, locale)).toHaveCount(0);
            await expect(removeButton(page, locale)).toHaveCount(0);
            await expect(profile.locator("[role='status']")).toHaveCount(0);
            await expect(profile).not.toContainText(
              m.accountProfileAvatarHint({}, { locale })
            );
            stateResults.push(
              await captureAvatarState({
                fixture,
                locale,
                outputDirectory,
                page,
                stateId: "hidden-profile",
                viewport,
              })
            );
            await page.close();
            continue;
          }

          // The default synthetic fixture represents an enabled capability
          // with no saved image, so this capture proves the real initials path.
          await expect(profile.locator("img")).toHaveCount(0);
          await expect(profile.getByText("AE")).toBeVisible();
          await expect(cameraButton(page, locale)).toBeVisible();
          await expect(profile.locator("input[type='file']")).toHaveCount(1);
          await expect(removeButton(page, locale)).toHaveCount(0);
          await expect(
            profile.getByText(m.accountProfileAvatarHint({}, { locale }))
          ).toBeVisible();
          await expect(statusRegion(page)).toHaveText("");
          stateResults.push(
            await captureAvatarState({
              expectedStatusText: "",
              fixture,
              locale,
              outputDirectory,
              page,
              stateId: "fallback",
              viewport,
            })
          );
          await page.close();

          // Pending upload holds the real action in flight from the fallback.
          {
            const pendingPage = await loadRendererPage(
              context,
              staticServer.baseUrl,
              "profile",
              problems,
              "screen=profile&section=profile"
            );
            const expected = m.accountProfileAvatarUploading({}, { locale });
            await uploadViaFileInput(
              pendingPage,
              syntheticPng,
              "pending-upload"
            );
            await expect(statusRegion(pendingPage)).toHaveText(expected);
            await expect(cameraButton(pendingPage, locale)).toBeDisabled();
            stateResults.push(
              await captureAvatarState({
                expectedStatusText: expected,
                fixture,
                locale,
                outputDirectory,
                page: pendingPage,
                stateId: "pending-upload",
                viewport,
              })
            );
            await pendingPage.close();
          }

          // Uploaded and error states use a synthetic image to prove a failed
          // replacement leaves the previously saved image visible.
          {
            const uploadedPage = await loadRendererPage(
              context,
              staticServer.baseUrl,
              "profile",
              problems,
              "screen=profile&section=profile"
            );
            const expected = m.accountProfileAvatarUpdated({}, { locale });
            await uploadViaFileInput(uploadedPage, syntheticPng, "uploaded");
            await expect(statusRegion(uploadedPage)).toHaveText(expected);
            await expect(
              uploadedPage.locator("img[src^='data:image/png']")
            ).toBeVisible();
            await expect(removeButton(uploadedPage, locale)).toBeVisible();
            stateResults.push(
              await captureAvatarState({
                expectedStatusText: expected,
                fixture,
                locale,
                outputDirectory,
                page: uploadedPage,
                stateId: "uploaded",
                viewport,
              })
            );
            await uploadedPage.close();
          }

          {
            const errorPage = await loadRendererPage(
              context,
              staticServer.baseUrl,
              "profile",
              problems,
              "screen=profile&section=profile"
            );
            await uploadViaFileInput(errorPage, syntheticPng, "uploaded");
            await expect(
              errorPage.locator("img[src^='data:image/png']")
            ).toBeVisible();
            const expected = m.accountProfileAvatarErrorRetryable(
              {},
              { locale }
            );
            await uploadViaFileInput(
              errorPage,
              syntheticPng,
              "retryable-upload"
            );
            await expect(statusRegion(errorPage)).toHaveText(expected);
            await expect(
              errorPage.locator("img[src^='data:image/png']")
            ).toBeVisible();
            stateResults.push(
              await captureAvatarState({
                expectedStatusText: expected,
                fixture,
                locale,
                outputDirectory,
                page: errorPage,
                stateId: "upload-error",
                viewport,
              })
            );
            await errorPage.close();
          }

          // Pending removal starts from a saved synthetic image.
          {
            const pendingRemovePage = await loadRendererPage(
              context,
              staticServer.baseUrl,
              "profile",
              problems,
              "screen=profile&section=profile"
            );
            await uploadViaFileInput(
              pendingRemovePage,
              syntheticPng,
              "uploaded"
            );
            await expect(
              pendingRemovePage.locator("img[src^='data:image/png']")
            ).toBeVisible();
            const expected = m.accountProfileAvatarRemoving({}, { locale });
            await removeViaButton(pendingRemovePage, locale, "pending-remove");
            await expect(statusRegion(pendingRemovePage)).toHaveText(expected);
            await expect(
              pendingRemovePage.getByRole("button", { name: expected }).first()
            ).toBeDisabled();
            await expect(
              cameraButton(pendingRemovePage, locale)
            ).toBeDisabled();
            stateResults.push(
              await captureAvatarState({
                expectedStatusText: expected,
                fixture,
                locale,
                outputDirectory,
                page: pendingRemovePage,
                stateId: "pending-remove",
                viewport,
              })
            );
            await pendingRemovePage.close();
          }

          // A successful removal restores the available/no-image fallback.
          {
            const removedPage = await loadRendererPage(
              context,
              staticServer.baseUrl,
              "profile",
              problems,
              "screen=profile&section=profile"
            );
            await uploadViaFileInput(removedPage, syntheticPng, "uploaded");
            await expect(
              removedPage.locator("img[src^='data:image/png']")
            ).toBeVisible();
            const expected = m.accountProfileAvatarRemoved({}, { locale });
            await removeViaButton(removedPage, locale, "removed");
            await expect(statusRegion(removedPage)).toHaveText(expected);
            await expect(
              removedPage.locator("img[src^='data:image/png']")
            ).toHaveCount(0);
            await expect(removeButton(removedPage, locale)).toHaveCount(0);
            stateResults.push(
              await captureAvatarState({
                expectedStatusText: expected,
                fixture,
                locale,
                outputDirectory,
                page: removedPage,
                stateId: "removed",
                viewport,
              })
            );
            await removedPage.close();
          }
        } finally {
          await context.close();
        }
      }
    } finally {
      await staticServer.server.stop(true);
    }
    bundleInputs.push({
      fixture,
      bundleInputs: bundle.manifest.bundleInputs,
    });
  };

  await captureFixture("available", "default-adapter.tsx");
  await captureFixture("hidden", "avatar-hidden-adapter.tsx");

  return { states: stateResults, bundleInputs };
};

const main = async () => {
  const { label, outputRoot, port } = parseArgs(Bun.argv.slice(2));
  assertCapturedSourcesMatchHead(await gitStatusPorcelainLines());
  const outputDirectory = await makeUniqueRunDirectory(outputRoot, label);
  const sha = await gitHeadSha();
  process.stdout.write(
    `[avatar-capture] capturing avatar states from commit ${sha}\n`
  );
  const sharp = createRequire(
    join(import.meta.dir, "../../../..", "packages/osm/package.json")
  )("sharp");
  const side = 96;
  const raw = Buffer.alloc(side * side * 4);
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const index = (y * side + x) * 4;
      const diagonal = x + y < side;
      raw[index] = diagonal ? 207 : 0;
      raw[index + 1] = diagonal ? 114 : 2;
      raw[index + 2] = diagonal ? 83 : 79;
      raw[index + 3] = 255;
    }
  }
  const syntheticPng = await sharp(raw, {
    raw: { width: side, height: side, channels: 4 },
  })
    .png()
    .toBuffer();
  const problems: BrowserProblem[] = [];
  const bundleInputs: Array<{
    readonly locale: AccountVisualLocale;
    readonly fixtures: Awaited<ReturnType<typeof runLocale>>["bundleInputs"];
  }> = [];
  const browser = await chromium.launch({ headless: true });
  const browserVersion = browser.version();
  const results: unknown[] = [];
  try {
    for (const locale of locales) {
      if (!isAccountVisualLocale(locale))
        throw new Error(`Invalid locale: ${locale}`);
      const localeResult = await runLocale({
        browser,
        outputDirectory,
        locale,
        port,
        problems,
        syntheticPng,
      });
      results.push(...localeResult.states);
      bundleInputs.push({ locale, fixtures: localeResult.bundleInputs });
    }
  } finally {
    await browser.close();
  }
  // Re-verify revision and source identity before publishing: the capture
  // must never attribute a tree that changed mid-run to the starting commit.
  if ((await gitHeadSha()) !== sha) {
    throw new Error(`HEAD moved during capture from ${sha}`);
  }
  assertCapturedSourcesMatchHead(await gitStatusPorcelainLines());
  const report = {
    schemaVersion: 1,
    capturedFromCommit: sha,
    browserVersion,
    fixtureAvatar: "synthetic only; never real customer media",
    coverage: avatarVisualCaptureChecklist,
    bundleInputs,
    states: results,
    problems,
  };
  const reportPath = join(outputDirectory, "avatar-states-report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(
    `[avatar-capture] wrote ${results.length} PNGs and ${reportPath}\n`
  );
  if (problems.length > 0) {
    process.stderr.write(
      `[avatar-capture] browser problems: ${JSON.stringify(problems)}\n`
    );
    process.exitCode = 1;
  }
};

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : "Avatar state capture failed"}\n`
    );
    process.exitCode = 1;
  }
}
