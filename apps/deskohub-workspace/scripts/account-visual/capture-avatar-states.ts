import { execSync } from "node:child_process";
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
 * Captures the profile avatar pending and success aria-live states from the
 * exact committed AvatarControl implementation in the real profile screen.
 * The component is never mocked: states are driven by real clicks on the
 * camera button's file input (Playwright setInputFiles on the real sr-only
 * input) and real clicks on the remove button, while the harness's
 * controllable action stub in `stubs/account-actions.ts` holds the Server
 * Action pending or resolves it with a synthetic success payload. Never real
 * customer media: the success avatar is a synthetic data-URL PNG.
 *
 * Usage:
 *   WORKSPACE_ACCOUNT_VISUAL_PORT=3999 bun apps/deskohub-workspace/scripts/account-visual/capture-avatar-states.ts --label avatar-evidence
 */

const desktopCssWidth = 1280;
const desktopCssHeight = 2400;
const desktopDeviceScaleFactor = 2;
const defaultPort = 3111;
const locales: readonly AccountVisualLocale[] = ["en-US", "cs-CZ"];

type AvatarStateId =
  | "pending-upload"
  | "uploaded"
  | "pending-remove"
  | "removed";

const gitHeadSha = (): string =>
  execSync("git rev-parse HEAD", {
    cwd: resolve(import.meta.dir, "../../../.."),
  })
    .toString()
    .trim();

const repoRoot = resolve(import.meta.dir, "../../../..");

/**
 * The bundle is compiled from the working tree, so any staged, unstaged, or
 * untracked difference from HEAD would make the report misattribute a dirty
 * tree to the clean commit. `--untracked-files=all` is explicit because
 * `git status` otherwise honors `status.showUntrackedFiles=no` from git
 * config and would silently hide untracked build inputs.
 */
export const gitStatusPorcelainLines = (
  cwd: string = repoRoot
): readonly string[] =>
  execSync("git status --porcelain=v1 --untracked-files=all", { cwd })
    .toString()
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
  outcome: "pending-upload" | "uploaded"
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

    const openProfilePage = async () => {
      const page = await loadRendererPage(
        context,
        staticServer.baseUrl,
        "profile",
        problems,
        "screen=profile&section=profile"
      );
      await expect(
        page.locator("[data-screen='profile-screen']")
      ).toBeVisible();
      return page;
    };

    const captureState = async (page: Page, stateId: AvatarStateId) => {
      const file = join(outputDirectory, `avatar-${stateId}-${locale}.png`);
      const main = page.locator("main").first();
      await main.screenshot({ path: file, animations: "disabled" });
      return { stateId, locale, file };
    };

    // 1. uploaded: real upload resolves with the synthetic avatar; success
    //    message shows and the image replaces the initials.
    {
      const page = await openProfilePage();
      const expected = m.accountProfileAvatarUpdated({}, { locale });
      await uploadViaFileInput(page, syntheticPng, "uploaded");
      await expect(statusRegion(page)).toHaveText(expected);
      await expect(page.locator("img[src^='data:image/png']")).toBeVisible();
      await expect(removeButton(page, locale)).toBeVisible();
      const actual = await statusRegionText(page);
      stateResults.push({
        ...(await captureState(page, "uploaded")),
        expectedStatusText: expected,
        actualStatusText: actual,
      });

      // 2. pending-remove: real remove click held pending by the stub.
      {
        const expectedRemoving = m.accountProfileAvatarRemoving({}, { locale });
        await removeViaButton(page, locale, "pending-remove");
        await expect(statusRegion(page)).toHaveText(expectedRemoving);
        // While pending, the real component renames the remove button to
        // "Removing…" and disables both controls.
        await expect(
          page
            .getByRole("button", {
              name: expectedRemoving,
            })
            .first()
        ).toBeDisabled();
        await expect(cameraButton(page, locale)).toBeDisabled();
        const actual = await statusRegionText(page);
        stateResults.push({
          ...(await captureState(page, "pending-remove")),
          expectedStatusText: expectedRemoving,
          actualStatusText: actual,
        });
      }
      await page.close();
    }

    // 3. pending-upload: real file injection held pending by the stub;
    //    uploading message with disabled camera control.
    {
      const page = await openProfilePage();
      const expected = m.accountProfileAvatarUploading({}, { locale });
      await uploadViaFileInput(page, syntheticPng, "pending-upload");
      await expect(statusRegion(page)).toHaveText(expected);
      await expect(cameraButton(page, locale)).toBeDisabled();
      const actual = await statusRegionText(page);
      stateResults.push({
        ...(await captureState(page, "pending-upload")),
        expectedStatusText: expected,
        actualStatusText: actual,
      });
      await page.close();
    }

    // 4. removed: real upload then real remove click resolving removed;
    //    initials return with the removed success message.
    {
      const page = await openProfilePage();
      await uploadViaFileInput(page, syntheticPng, "uploaded");
      await expect(page.locator("img[src^='data:image/png']")).toBeVisible();
      const expected = m.accountProfileAvatarRemoved({}, { locale });
      await removeViaButton(page, locale, "removed");
      await expect(statusRegion(page)).toHaveText(expected);
      await expect(page.locator("img[src^='data:image/png']")).toHaveCount(0);
      await expect(removeButton(page, locale)).toHaveCount(0);
      const actual = await statusRegionText(page);
      stateResults.push({
        ...(await captureState(page, "removed")),
        expectedStatusText: expected,
        actualStatusText: actual,
      });
      await page.close();
    }

    await context.close();
  } finally {
    await staticServer.server.stop(true);
  }
  return { states: stateResults, bundleInputs: bundle.manifest.bundleInputs };
};

const main = async () => {
  const { label, outputRoot, port } = parseArgs(Bun.argv.slice(2));
  assertCapturedSourcesMatchHead(gitStatusPorcelainLines());
  const outputDirectory = await makeUniqueRunDirectory(outputRoot, label);
  const sha = gitHeadSha();
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
    readonly bundleInputs: Awaited<
      ReturnType<typeof buildBundle>
    >["manifest"]["bundleInputs"];
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
      bundleInputs.push({ locale, bundleInputs: localeResult.bundleInputs });
    }
  } finally {
    await browser.close();
  }
  // Re-verify revision and source identity before publishing: the capture
  // must never attribute a tree that changed mid-run to the starting commit.
  if (gitHeadSha() !== sha) {
    throw new Error(`HEAD moved during capture from ${sha}`);
  }
  assertCapturedSourcesMatchHead(gitStatusPorcelainLines());
  const report = {
    schemaVersion: 1,
    capturedFromCommit: sha,
    browserVersion,
    fixtureAvatar: "synthetic only; never real customer media",
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
