import { expect, spyOn, test } from "bun:test";
import {
  access,
  constants,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, join, relative, resolve } from "node:path";
import {
  type Browser,
  type BrowserContext,
  chromium,
  type Page,
} from "@playwright/test";
import { marketingPreferencesFormCopy } from "../../features/legal/components/marketing-preferences-form.copy";
import {
  compileMarketingPreferencesFixture,
  formatBuildDiagnostics,
} from "./marketing-preferences-fixture";

const repoRoot = resolve(import.meta.dir, "../../../..");
const appRoot = resolve(import.meta.dir, "../..");
const artifactRoot = join(repoRoot, ".artifacts/marketing-preferences-browser");
const adapterPath = join(import.meta.dir, "marketing-preferences-adapter.tsx");
const productionFormPath = join(
  appRoot,
  "features/legal/components/marketing-preferences-form.tsx"
);
const productionCopyPath = join(
  appRoot,
  "features/legal/components/marketing-preferences-form.copy.ts"
);
const rendererCssPath = join(import.meta.dir, "renderer.css");
const regularFontPath = join(appRoot, "assets/fonts/Sculpin/regular.woff2");
const italicFontPath = join(appRoot, "assets/fonts/Sculpin/italic.woff2");

const chromiumAvailable = await access(
  chromium.executablePath(),
  constants.X_OK
)
  .then(() => true)
  .catch(() => false);

let browser: Browser | undefined;

const locales = ["en-US", "cs-CZ"] as const;
type Locale = (typeof locales)[number];

const viewports = [
  { height: 900, name: "320", width: 320 },
  { height: 900, name: "375", width: 375 },
  { height: 900, name: "desktop", width: 1280 },
] as const;
type Viewport = (typeof viewports)[number];

const scenarios = [
  "pending-link",
  "account-absent",
  "account-active",
  "account-withdrawn",
  "link-absent",
  "link-active",
  "link-withdrawn",
  "unavailable",
  "invalid-link",
] as const;
type Scenario = (typeof scenarios)[number];

type Rect = {
  readonly bottom: number;
  readonly height: number;
  readonly right: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
};

type InteractiveElement = {
  readonly disabled: boolean;
  readonly id: string;
  readonly label: string;
  readonly tag: string;
  readonly visible: boolean;
};

type Geometry = {
  readonly bodyScrollWidth: number;
  readonly documentScrollWidth: number;
  readonly interactive: readonly InteractiveElement[];
  readonly main: Rect | null;
  readonly offenders: readonly {
    readonly id: string;
    readonly rect: Rect;
    readonly tag: string;
  }[];
  readonly section: Rect | null;
  readonly viewport: { readonly height: number; readonly width: number };
};

type FocusTarget = {
  readonly id: string;
  readonly label: string;
  readonly role: string | null;
  readonly tag: string;
};

type ActionEvent = {
  readonly action: "clear" | "confirm" | "save";
  readonly input: {
    readonly confirmed?: boolean;
    readonly context?: string;
    readonly granted?: boolean;
    readonly locale?: Locale;
    readonly source?: "account" | "link";
  };
};

type ScreenshotEvidence = {
  readonly actions: readonly ActionEvent[];
  readonly focusSequence: readonly FocusTarget[];
  readonly geometry: Geometry;
  readonly locale: Locale;
  readonly phase: string;
  readonly scenario: Scenario;
  readonly screenshot: string;
  readonly viewport: string;
};

type BrowserProblems = {
  readonly consoleErrors: string[];
  readonly externalRequests: string[];
  readonly pageErrors: string[];
};

const makeHtml = (javascriptPath: string, cssPath: string) => `<!doctype html>
<html lang="en-US">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="/${basename(cssPath)}">
    <link rel="stylesheet" href="/renderer.css">
  </head>
  <body>
    <div id="marketing-preferences-browser-root"></div>
    <script type="module" src="/${basename(javascriptPath)}"></script>
  </body>
</html>
`;

const serveBundle = async (
  bundle: Awaited<ReturnType<typeof compileMarketingPreferencesFixture>>
) => {
  const assets = new Map<
    string,
    { readonly body: Uint8Array; readonly type: string }
  >([
    [
      `/${basename(bundle.javascriptPath)}`,
      {
        body: await readFile(bundle.javascriptPath),
        type: "text/javascript; charset=utf-8",
      },
    ],
    [
      `/${basename(bundle.cssPath)}`,
      { body: await readFile(bundle.cssPath), type: "text/css; charset=utf-8" },
    ],
    [
      "/renderer.css",
      {
        body: await readFile(rendererCssPath),
        type: "text/css; charset=utf-8",
      },
    ],
    [
      "/__account-visual-fonts/sculpin-regular.woff2",
      { body: await readFile(regularFontPath), type: "font/woff2" },
    ],
    [
      "/__account-visual-fonts/sculpin-italic.woff2",
      { body: await readFile(italicFontPath), type: "font/woff2" },
    ],
  ]);
  const html = makeHtml(bundle.javascriptPath, bundle.cssPath);
  const server = Bun.serve({
    fetch(request) {
      if (request.method !== "GET") return new Response(null, { status: 405 });
      const url = new URL(request.url);
      if (url.pathname === "/" || url.pathname === "/index.html") {
        return new Response(html, {
          headers: {
            "Cache-Control": "no-store",
            "Content-Type": "text/html; charset=utf-8",
          },
        });
      }
      const asset = assets.get(url.pathname);
      if (!asset) return new Response(null, { status: 404 });
      return new Response(Buffer.from(asset.body), {
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": asset.type,
        },
      });
    },
    hostname: "127.0.0.1",
    port: 0,
  });
  return { baseUrl: `http://127.0.0.1:${server.port}`, server } as const;
};

const fixtureChildScript = (stdout: string, exitCode = 0): string =>
  `process.stdout.write(${JSON.stringify(stdout)}); process.exitCode = ${exitCode};`;

const withMockedFixtureChild = async <T,>(
  script: string,
  check: () => Promise<T>
): Promise<T> => {
  const originalSpawn = Bun.spawn.bind(Bun);
  let child: Bun.Subprocess | undefined;
  const spawn = spyOn(Bun, "spawn").mockImplementation((_command, options) => {
    child = originalSpawn([process.execPath, "-e", script], options);
    return child;
  });

  try {
    return await check();
  } finally {
    spawn.mockRestore();
    await child?.exited.catch(() => undefined);
  }
};

const writeMockFixtureOutputs = async (outputDirectory: string) => {
  await mkdir(outputDirectory, { recursive: true });
  const schedulerPath = createRequire(join(appRoot, "package.json")).resolve(
    "scheduler"
  );
  const schedulerBytes = await readFile(schedulerPath);
  const cssPath = join(outputDirectory, "entry.css");
  const entryPath = join(outputDirectory, "entry.tsx");
  const javascriptPath = join(outputDirectory, "entry.js");
  await writeFile(cssPath, "/* synthetic CSS */\n", "utf8");
  await writeFile(entryPath, "export {};\n", "utf8");
  await writeFile(javascriptPath, "const syntheticBundle = true;\n", "utf8");
  return {
    bunVersion: Bun.version,
    cssPath,
    entryPath,
    javascriptPath,
    scheduler: { bytes: schedulerBytes.byteLength, path: schedulerPath },
    status: "ok" as const,
  };
};

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const readGeometry = async (page: Page): Promise<Geometry> =>
  page.evaluate(() => {
    const isVisible = (element: Element) => {
      const htmlElement = element as HTMLElement;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return (
        !htmlElement.hidden &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const rect = (element: Element | null) => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return {
        bottom: value.bottom,
        height: value.height,
        right: value.right,
        width: value.width,
        x: value.x,
        y: value.y,
      };
    };
    const accessibleLabel = (element: HTMLElement) => {
      const ariaLabel = element.getAttribute("aria-label")?.trim();
      if (ariaLabel) return ariaLabel;
      const labelledBy = element.getAttribute("aria-labelledby");
      if (labelledBy) {
        const value = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
          .filter(Boolean)
          .join(" ");
        if (value) return value;
      }
      if (element.id) {
        const label = document.querySelector<HTMLLabelElement>(
          `label[for="${CSS.escape(element.id)}"]`
        );
        if (label?.textContent?.trim()) return label.textContent.trim();
      }
      return element.textContent?.trim().replace(/\s+/g, " ") ?? "";
    };
    const interactive = Array.from(
      document.querySelectorAll<HTMLElement>(
        "button, a, input, select, textarea, [role='checkbox']"
      )
    ).map((element) => ({
      disabled:
        element instanceof HTMLButtonElement ||
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement
          ? element.disabled
          : element.getAttribute("aria-disabled") === "true",
      id: element.id,
      label: accessibleLabel(element),
      tag: element.tagName.toLowerCase(),
      visible: isVisible(element),
    }));
    const viewportWidth = document.documentElement.clientWidth;
    const offenders = Array.from(
      document.querySelectorAll<HTMLElement>(
        "[data-account-visual-mode] main, [data-account-visual-mode] main *"
      )
    )
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(
        ({ element, rect }) =>
          isVisible(element) &&
          (rect.left < -1 || rect.right > viewportWidth + 1)
      )
      .slice(0, 50)
      .map(({ element, rect }) => ({
        id: element.id,
        rect: {
          bottom: rect.bottom,
          height: rect.height,
          right: rect.right,
          width: rect.width,
          x: rect.x,
          y: rect.y,
        },
        tag: element.tagName.toLowerCase(),
      }));
    const main = document.querySelector("main");
    const section = document.querySelector("[data-marketing-preferences]");
    return {
      bodyScrollWidth: document.body.scrollWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      interactive,
      main: rect(main),
      offenders,
      section: rect(section),
      viewport: { height: window.innerHeight, width: viewportWidth },
    };
  });

const readActionLog = async (page: Page): Promise<readonly ActionEvent[]> =>
  page.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      readonly __marketingPreferencesActionLog?: {
        readonly events?: readonly ActionEvent[];
      };
    };
    return [...(scope.__marketingPreferencesActionLog?.events ?? [])];
  });

const readFocusTarget = async (page: Page): Promise<FocusTarget | null> =>
  page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement) || element === document.body)
      return null;
    const label =
      element.getAttribute("aria-label")?.trim() ??
      (element.id
        ? document
            .querySelector<HTMLLabelElement>(
              `label[for="${CSS.escape(element.id)}"]`
            )
            ?.textContent?.trim()
        : undefined) ??
      element.textContent?.trim().replace(/\s+/g, " ") ??
      "";
    return {
      id: element.id,
      label,
      role: element.getAttribute("role"),
      tag: element.tagName.toLowerCase(),
    };
  });

const readKeyboardEvidence = async (page: Page) => {
  const sequence: FocusTarget[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < 32; index += 1) {
    await page.keyboard.press("Tab");
    const target = await readFocusTarget(page);
    if (!target || target.label.length === 0) continue;
    const key = `${target.tag}|${target.id}|${target.role ?? ""}|${target.label}`;
    if (seen.has(key)) break;
    seen.add(key);
    sequence.push(target);
  }
  return sequence;
};

const scenarioStatus = (scenario: Scenario) => {
  if (scenario === "pending-link") return "pending-link";
  if (scenario === "unavailable") return "unavailable";
  if (scenario === "invalid-link") return "invalid-link";
  return scenario.split("-")[1];
};

const contextFor = (scenario: Scenario, suffix = "a") =>
  `synthetic-${scenario}-context-${suffix}`;

const dismissalContextFor = (scenario: Scenario, suffix = "a") =>
  `synthetic-${scenario}-dismissal-context-${suffix}`;

const queryFor = (
  locale: Locale,
  scenario: Scenario,
  extra: Readonly<Record<string, string>> = {}
) => {
  const params = new URLSearchParams({ case: scenario, locale, ...extra });
  return `/?${params.toString()}`;
};

const waitForBodyText = async (page: Page, text: string) => {
  await page.waitForFunction(
    (expected) => document.body.textContent?.includes(expected) ?? false,
    text,
    { timeout: 5_000 }
  );
};

const loadPage = async (
  context: BrowserContext,
  baseUrl: string,
  locale: Locale,
  scenario: Scenario,
  problems: BrowserProblems,
  extra: Readonly<Record<string, string>> = {}
) => {
  const page = await context.newPage();
  addPageDiagnostics(page, problems);
  await page.goto(`${baseUrl}${queryFor(locale, scenario, extra)}`, {
    timeout: 15_000,
    waitUntil: "load",
  });
  await page
    .locator(`[data-marketing-preferences="${scenarioStatus(scenario)}"]`)
    .waitFor({ state: "visible", timeout: 15_000 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );
  });
  return page;
};

const assertGeometryAndKeyboard = async (page: Page) => {
  const geometry = await readGeometry(page);
  expect(geometry.documentScrollWidth).toBeLessThanOrEqual(
    geometry.viewport.width + 1
  );
  expect(geometry.bodyScrollWidth).toBeLessThanOrEqual(
    geometry.viewport.width + 1
  );
  expect(geometry.offenders).toEqual([]);
  expect(geometry.main?.right ?? 0).toBeLessThanOrEqual(
    geometry.viewport.width + 1
  );
  expect(geometry.section?.right ?? 0).toBeLessThanOrEqual(
    geometry.viewport.width + 1
  );
  expect(
    geometry.interactive.filter(({ label, visible }) => visible && !label)
  ).toEqual([]);

  const focusSequence = await readKeyboardEvidence(page);
  const enabledLabels = geometry.interactive
    .filter(({ disabled, label, visible }) => visible && !disabled && label)
    .map(({ label }) => label);
  for (const label of enabledLabels) {
    expect(
      focusSequence.map(({ label: focusedLabel }) => focusedLabel)
    ).toContain(label);
  }
  return { focusSequence, geometry } as const;
};

const screenshot = async ({
  page,
  locale,
  phase,
  scenario,
  viewport,
}: {
  readonly locale: Locale;
  readonly page: Page;
  readonly phase: string;
  readonly scenario: Scenario;
  readonly viewport: Viewport;
}) => {
  await page.evaluate(() => window.scrollTo(0, 0));
  const path = join(
    artifactRoot,
    `${phase}-${locale}-${viewport.name}-${scenario}.png`
  );
  await page.screenshot({ animations: "disabled", path });
  const { focusSequence, geometry } = await assertGeometryAndKeyboard(page);
  return {
    actions: await readActionLog(page),
    focusSequence,
    geometry,
    locale,
    phase,
    scenario,
    screenshot: relative(repoRoot, path),
    viewport: viewport.name,
  } satisfies ScreenshotEvidence;
};

const assertInitialState = async (
  page: Page,
  locale: Locale,
  scenario: Scenario
) => {
  const copy = marketingPreferencesFormCopy[locale];
  const section = page.locator(
    `[data-marketing-preferences="${scenarioStatus(scenario)}"]`
  );
  expect(await section.count()).toBe(1);

  if (scenario === "pending-link") {
    expect(
      await page.getByRole("button", { name: copy.continueAction }).count()
    ).toBe(1);
    expect(
      await page.getByRole("button", { name: copy.clearAction }).count()
    ).toBe(1);
    expect(await page.getByRole("checkbox").count()).toBe(0);
    expect(await page.getByText(copy.pendingDescription).count()).toBe(1);
    return;
  }

  if (scenario === "unavailable") {
    expect(await page.getByText(copy.unavailableNextStep).count()).toBe(1);
    expect(await page.getByText(copy.unavailableSignInNextStep).count()).toBe(
      1
    );
    expect(
      await page
        .getByRole("link", { name: copy.signInAction })
        .getAttribute("href")
    ).toBe(`/${locale}/auth/sign-in`);
    expect(await page.getByRole("checkbox").count()).toBe(0);
    expect(
      await page.getByRole("button", { name: copy.continueAction }).count()
    ).toBe(0);
    return;
  }

  if (scenario === "invalid-link") {
    expect(await page.getByText(copy.invalidLinkDescription).count()).toBe(1);
    expect(
      await page.getByRole("link", { name: copy.signInAction }).count()
    ).toBe(0);
    expect(await page.getByRole("checkbox").count()).toBe(0);
    expect(
      await page.getByRole("button", { name: copy.continueAction }).count()
    ).toBe(0);
    expect(
      await page.getByRole("button", { name: copy.clearAction }).count()
    ).toBe(1);
    return;
  }

  const source = scenario.startsWith("link-") ? "link" : "account";
  const status = scenario.split("-")[1];
  const expectedAction =
    status === "active" ? copy.withdrawAction : copy.grantAction;
  expect(await page.getByRole("checkbox").count()).toBe(1);
  expect(
    await page.getByRole("button", { name: expectedAction }).isDisabled()
  ).toBe(true);
  expect(
    await page
      .getByText(source === "link" ? copy.linkContext : copy.accountContext)
      .count()
  ).toBe(1);
  expect(
    await page
      .getByText(source === "link" ? copy.accountContext : copy.linkContext)
      .count()
  ).toBe(0);
  if (source === "link") {
    expect(
      await page.getByRole("button", { name: copy.clearAction }).count()
    ).toBe(1);
  } else {
    expect(
      await page.getByRole("button", { name: copy.clearAction }).count()
    ).toBe(0);
  }
};

const assertActionEvent = (
  event: ActionEvent | undefined,
  expected: {
    readonly action: ActionEvent["action"];
    readonly input?: Partial<ActionEvent["input"]>;
  }
) => {
  expect(event).toBeDefined();
  expect(event).toMatchObject(expected);
};

const addPageDiagnostics = (page: Page, problems: BrowserProblems) => {
  page.on("pageerror", (error) => problems.pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") problems.consoleErrors.push(message.text());
  });
};

const createContext = async (
  runningBrowser: Browser,
  baseUrl: string,
  viewport: Viewport,
  locale: Locale,
  problems: BrowserProblems
) => {
  const context = await runningBrowser.newContext({
    deviceScaleFactor: 1,
    locale,
    reducedMotion: "reduce",
    viewport: { height: viewport.height, width: viewport.width },
  });
  await context.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin !== baseUrl) {
      problems.externalRequests.push(requestUrl.origin);
      await route.abort();
      return;
    }
    await route.continue();
  });
  return context;
};

const runInitialCapture = async ({
  baseUrl,
  locale,
  problems,
  scenario,
  viewport,
}: {
  readonly baseUrl: string;
  readonly locale: Locale;
  readonly problems: BrowserProblems;
  readonly scenario: Scenario;
  readonly viewport: Viewport;
}) => {
  const runningBrowser = browser;
  if (!runningBrowser)
    throw new Error("Marketing preferences browser is unavailable");
  const context = await createContext(
    runningBrowser,
    baseUrl,
    viewport,
    locale,
    problems
  );
  const page = await loadPage(context, baseUrl, locale, scenario, problems);
  try {
    await assertInitialState(page, locale, scenario);
    return await screenshot({
      locale,
      page,
      phase: "state",
      scenario,
      viewport,
    });
  } finally {
    await page.close();
    await context.close();
  }
};

const runPendingTransitions = async ({
  baseUrl,
  locale,
  problems,
  viewport,
}: {
  readonly baseUrl: string;
  readonly locale: Locale;
  readonly problems: BrowserProblems;
  readonly viewport: Viewport;
}) => {
  const runningBrowser = browser;
  if (!runningBrowser)
    throw new Error("Marketing preferences browser is unavailable");
  const evidence: ScreenshotEvidence[] = [];
  const context = await createContext(
    runningBrowser,
    baseUrl,
    viewport,
    locale,
    problems
  );
  try {
    const successPage = await loadPage(
      context,
      baseUrl,
      locale,
      "pending-link",
      problems,
      { confirmOutcome: "success" }
    );
    try {
      await successPage
        .getByRole("button", {
          name: marketingPreferencesFormCopy[locale].continueAction,
        })
        .click();
      await waitForBodyText(
        successPage,
        marketingPreferencesFormCopy[locale].confirmed
      );
      assertActionEvent((await readActionLog(successPage))[0], {
        action: "confirm",
        input: { context: contextFor("pending-link") },
      });
      evidence.push(
        await screenshot({
          locale,
          page: successPage,
          phase: "pending-continue-success",
          scenario: "pending-link",
          viewport,
        })
      );
    } finally {
      await successPage.close();
    }

    const errorPage = await loadPage(
      context,
      baseUrl,
      locale,
      "pending-link",
      problems,
      { confirmOutcome: "error" }
    );
    try {
      const copy = marketingPreferencesFormCopy[locale];
      await errorPage
        .getByRole("button", { name: copy.continueAction })
        .click();
      await errorPage
        .getByRole("alert")
        .waitFor({ state: "visible", timeout: 5_000 });
      expect(await errorPage.getByText(copy.pendingDescription).count()).toBe(
        1
      );
      expect(await errorPage.getByRole("checkbox").count()).toBe(0);
      assertActionEvent((await readActionLog(errorPage))[0], {
        action: "confirm",
        input: { context: contextFor("pending-link") },
      });
      evidence.push(
        await screenshot({
          locale,
          page: errorPage,
          phase: "pending-continue-error",
          scenario: "pending-link",
          viewport,
        })
      );
    } finally {
      await errorPage.close();
    }
  } finally {
    await context.close();
  }
  return evidence;
};

const runSaveTransitions = async ({
  baseUrl,
  locale,
  problems,
  scenario,
  viewport,
}: {
  readonly baseUrl: string;
  readonly locale: Locale;
  readonly problems: BrowserProblems;
  readonly scenario: "account-absent" | "account-active" | "account-withdrawn";
  readonly viewport: Viewport;
}) => {
  const runningBrowser = browser;
  if (!runningBrowser)
    throw new Error("Marketing preferences browser is unavailable");
  const evidence: ScreenshotEvidence[] = [];
  const context = await createContext(
    runningBrowser,
    baseUrl,
    viewport,
    locale,
    problems
  );
  try {
    const source = "account" as const;
    const granted = scenario !== "account-active";
    const expectedAction = granted
      ? marketingPreferencesFormCopy[locale].grantAction
      : marketingPreferencesFormCopy[locale].withdrawAction;
    for (const outcome of ["success", "error"] as const) {
      const page = await loadPage(
        context,
        baseUrl,
        locale,
        scenario,
        problems,
        { saveOutcome: outcome }
      );
      try {
        const copy = marketingPreferencesFormCopy[locale];
        const checkbox = page.getByRole("checkbox");
        expect(await readActionLog(page)).toEqual([]);
        await checkbox.click();
        const saveButton = page.getByRole("button", { name: expectedAction });
        expect(await saveButton.isDisabled()).toBe(false);
        await saveButton.click();
        if (outcome === "success") {
          await waitForBodyText(page, copy.saved);
        } else {
          await page
            .getByRole("alert")
            .waitFor({ state: "visible", timeout: 5_000 });
          await waitForBodyText(page, copy.saveError);
        }
        assertActionEvent((await readActionLog(page))[0], {
          action: "save",
          input: {
            context: contextFor(scenario),
            granted,
            source,
          },
        });
        evidence.push(
          await screenshot({
            locale,
            page,
            phase: `account-${scenario}-save-${outcome}`,
            scenario,
            viewport,
          })
        );
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
  }
  return evidence;
};

const runLinkClearTransitions = async ({
  baseUrl,
  locale,
  problems,
  viewport,
}: {
  readonly baseUrl: string;
  readonly locale: Locale;
  readonly problems: BrowserProblems;
  readonly viewport: Viewport;
}) => {
  const runningBrowser = browser;
  if (!runningBrowser)
    throw new Error("Marketing preferences browser is unavailable");
  const evidence: ScreenshotEvidence[] = [];
  const context = await createContext(
    runningBrowser,
    baseUrl,
    viewport,
    locale,
    problems
  );
  try {
    for (const outcome of ["success", "error"] as const) {
      const page = await loadPage(
        context,
        baseUrl,
        locale,
        "link-active",
        problems,
        { clearOutcome: outcome }
      );
      try {
        const copy = marketingPreferencesFormCopy[locale];
        await page.getByRole("button", { name: copy.clearAction }).click();
        if (outcome === "success") {
          await waitForBodyText(page, copy.cleared);
        } else {
          await page
            .getByRole("alert")
            .waitFor({ state: "visible", timeout: 5_000 });
          await waitForBodyText(page, copy.clearError);
        }
        assertActionEvent((await readActionLog(page))[0], {
          action: "clear",
          input: { context: dismissalContextFor("link-active") },
        });
        evidence.push(
          await screenshot({
            locale,
            page,
            phase: `link-active-clear-${outcome}`,
            scenario: "link-active",
            viewport,
          })
        );
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
  }
  return evidence;
};

const runContextReplacement = async ({
  baseUrl,
  locale,
  problems,
  viewport,
}: {
  readonly baseUrl: string;
  readonly locale: Locale;
  readonly problems: BrowserProblems;
  readonly viewport: Viewport;
}) => {
  const runningBrowser = browser;
  if (!runningBrowser)
    throw new Error("Marketing preferences browser is unavailable");
  const context = await createContext(
    runningBrowser,
    baseUrl,
    viewport,
    locale,
    problems
  );
  const page = await loadPage(
    context,
    baseUrl,
    locale,
    "link-absent",
    problems,
    { context: "a" }
  );
  try {
    const copy = marketingPreferencesFormCopy[locale];
    const checkbox = page.getByRole("checkbox");
    await checkbox.click();
    expect(await checkbox.getAttribute("aria-checked")).toBe("true");
    const before = await screenshot({
      locale,
      page,
      phase: "context-replacement-confirmed",
      scenario: "link-absent",
      viewport,
    });
    await page
      .getByRole("button", { name: "Replace synthetic context" })
      .click();
    await page.waitForFunction(
      () => new URL(window.location.href).searchParams.get("context") === "b",
      undefined,
      { timeout: 5_000 }
    );
    await page.waitForFunction(
      () =>
        document
          .querySelector("[role='checkbox']")
          ?.getAttribute("aria-checked") === "false",
      undefined,
      { timeout: 5_000 }
    );
    expect(
      await page.getByRole("button", { name: copy.grantAction }).isDisabled()
    ).toBe(true);
    expect(await readActionLog(page)).toEqual([]);
    const after = await screenshot({
      locale,
      page,
      phase: "context-replacement-reset",
      scenario: "link-absent",
      viewport,
    });
    return [before, after] as const;
  } finally {
    await page.close();
    await context.close();
  }
};

const runAccountsDisabledChecks = async ({
  baseUrl,
  locale,
  problems,
  viewport,
}: {
  readonly baseUrl: string;
  readonly locale: Locale;
  readonly problems: BrowserProblems;
  readonly viewport: Viewport;
}) => {
  const runningBrowser = browser;
  if (!runningBrowser)
    throw new Error("Marketing preferences browser is unavailable");
  const context = await createContext(
    runningBrowser,
    baseUrl,
    viewport,
    locale,
    problems
  );
  try {
    const unavailablePage = await loadPage(
      context,
      baseUrl,
      locale,
      "unavailable",
      problems,
      { accountsEnabled: "false" }
    );
    try {
      const copy = marketingPreferencesFormCopy[locale];
      expect(
        await unavailablePage.getByText(copy.unavailableNextStep).count()
      ).toBe(1);
      expect(
        await unavailablePage.getByText(copy.unavailableSignInNextStep).count()
      ).toBe(0);
      expect(
        await unavailablePage
          .getByRole("link", { name: copy.signInAction })
          .count()
      ).toBe(0);
    } finally {
      await unavailablePage.close();
    }

    const pendingPage = await loadPage(
      context,
      baseUrl,
      locale,
      "pending-link",
      problems,
      { accountsEnabled: "false", confirmOutcome: "success" }
    );
    try {
      const copy = marketingPreferencesFormCopy[locale];
      const continueButton = pendingPage.getByRole("button", {
        name: copy.continueAction,
      });
      expect(await continueButton.count()).toBe(1);
      await continueButton.click();
      await waitForBodyText(pendingPage, copy.confirmed);
      assertActionEvent((await readActionLog(pendingPage))[0], {
        action: "confirm",
        input: { context: contextFor("pending-link") },
      });
    } finally {
      await pendingPage.close();
    }
  } finally {
    await context.close();
  }
};

test("formats nested build diagnostics without attached payloads", () => {
  const output = formatBuildDiagnostics(
    new AggregateError([
      new AggregateError([
        {
          lineText: "synthetic line text",
          message:
            "Could not resolve the controlled renderer DATABASE_URL=synthetic-environment-value",
          position: {
            column: 4,
            file: "https://synthetic-user:synthetic-password@example.test/entry.tsx?token=synthetic-query-value",
            line: 17,
            lineText: "synthetic position line text",
          },
          token: "synthetic attached token value",
        },
      ]),
    ])
  );

  expect(output).toContain(
    "https://[REDACTED]@example.test/entry.tsx?token=[REDACTED]:17:4: Could not resolve the controlled renderer DATABASE_URL=[REDACTED]"
  );
  expect(output).not.toContain("synthetic line text");
  expect(output).not.toContain("synthetic attached token value");
  expect(output).not.toContain("synthetic-password");
  expect(output).not.toContain("synthetic-query-value");
  expect(output).not.toContain("synthetic-environment-value");
});

test("uses a safe fallback for unknown build diagnostics", () => {
  expect(
    formatBuildDiagnostics({
      toString: () => "synthetic unknown payload",
      unexpected: "synthetic unknown value",
    })
  ).toBe("[unknown build diagnostic]");
  expect(formatBuildDiagnostics("synthetic build failure")).toBe(
    "synthetic build failure"
  );
});

test("redacts build diagnostic environment assignment tails without crossing lines", () => {
  const output = formatBuildDiagnostics([
    {
      message: "DATABASE_URL=synthetic-environment-value, comma suffix",
    },
    {
      message: String.raw`API_KEY=synthetic-api-value, escaped quote \"suffix\"`,
    },
    {
      message:
        "MULTILINE=synthetic-multiline-value, hidden suffix\nnext diagnostic line is retained",
    },
  ]);

  expect(output).toContain(
    "DATABASE_URL=[REDACTED]\nAPI_KEY=[REDACTED]\nMULTILINE=[REDACTED]\nnext diagnostic line is retained"
  );
  expect(output).not.toContain("comma suffix");
  expect(output).not.toContain("escaped quote");
  expect(output).not.toContain("hidden suffix");
  expect(output).not.toContain("synthetic-environment-value");
  expect(output).not.toContain("synthetic-api-value");
  expect(output).not.toContain("synthetic-multiline-value");
});

test("formats native Bun build diagnostics with a source location", async () => {
  const diagnosticNamespace = "marketing-preferences-diagnostic";
  const diagnosticEntry = "virtual-marketing-preferences-diagnostic-entry";
  const missingModule = "./__missing_marketing_preferences_diagnostic__";
  let thrown: unknown;

  try {
    await Bun.build({
      entrypoints: [diagnosticEntry],
      format: "esm",
      plugins: [
        {
          name: "marketing-preferences-diagnostic",
          setup(build) {
            build.onResolve(
              { filter: /^virtual-marketing-preferences-diagnostic-entry$/ },
              () => ({
                namespace: diagnosticNamespace,
                path: diagnosticEntry,
              })
            );
            build.onLoad(
              {
                filter: /^virtual-marketing-preferences-diagnostic-entry$/,
                namespace: diagnosticNamespace,
              },
              () => ({
                contents: `import ${JSON.stringify(missingModule)};`,
                loader: "js",
                resolveDir: import.meta.dir,
              })
            );
          },
        },
      ],
    });
  } catch (cause) {
    thrown = cause;
  }

  expect(thrown).toBeInstanceOf(AggregateError);
  if (!(thrown instanceof AggregateError)) return;

  const output = formatBuildDiagnostics(thrown);
  expect(output).toContain(missingModule);
  expect(output).toMatch(new RegExp(`${diagnosticEntry}:\\d+:\\d+:`));
});

test.serial(
  "rejects an invalid marketing preferences child app root without leaking its path",
  async () => {
    await mkdir(artifactRoot, { recursive: true });
    const directory = await mkdtemp(
      join(artifactRoot, "marketing-preferences-invalid-app-root-")
    );
    const rawSentinel = "synthetic-invalid-app-root-sentinel";
    try {
      let thrown: unknown;
      try {
        await compileMarketingPreferencesFixture({
          appRoot: join(directory, `missing-DATABASE_URL=${rawSentinel}`),
          outputDirectory: join(directory, "output"),
        });
      } catch (cause) {
        thrown = cause;
      }

      expect(errorMessage(thrown)).toBe(
        "Could not launch marketing preferences fixture child"
      );
      expect(errorMessage(thrown)).not.toContain(rawSentinel);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }
);

test.serial(
  "sanitizes an actual marketing preferences child compiler fault",
  async () => {
    await mkdir(artifactRoot, { recursive: true });
    const directory = await mkdtemp(
      join(artifactRoot, "marketing-preferences-build-failure-")
    );
    const rawSentinel = "synthetic-build-diagnostic";
    const invalidAppRoot = join(directory, `app-DATABASE_URL=${rawSentinel}`);
    try {
      await mkdir(join(invalidAppRoot, "app"), { recursive: true });
      await mkdir(join(invalidAppRoot, "scripts/account-visual"), {
        recursive: true,
      });
      await writeFile(
        join(invalidAppRoot, "package.json"),
        JSON.stringify({
          name: "synthetic-marketing-preferences-app",
          type: "module",
        }),
        "utf8"
      );
      await symlink(
        join(appRoot, "node_modules"),
        join(invalidAppRoot, "node_modules"),
        "dir"
      );
      await writeFile(
        join(invalidAppRoot, "app/globals.css"),
        "body { margin: 0; }\n",
        "utf8"
      );
      await writeFile(
        join(invalidAppRoot, "postcss.config.mjs"),
        "export default { plugins: {} };\n",
        "utf8"
      );
      await writeFile(
        join(
          invalidAppRoot,
          "scripts/account-visual/marketing-preferences-adapter.tsx"
        ),
        `import "DATABASE_URL=${rawSentinel}";\nexport default function InvalidAdapter() { return null; }\n`,
        "utf8"
      );

      let thrown: unknown;
      try {
        await compileMarketingPreferencesFixture({
          appRoot: invalidAppRoot,
          outputDirectory: join(directory, "output"),
        });
      } catch (cause) {
        thrown = cause;
      }

      const message = errorMessage(thrown);
      expect(message).toContain("Marketing preferences fixture child failed");
      expect(message).toContain("DATABASE_URL=[REDACTED]");
      expect(message).not.toContain(rawSentinel);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }
);

test.serial(
  "kills and awaits a timed-out marketing preferences fixture child",
  async () => {
    await mkdir(artifactRoot, { recursive: true });
    const directory = await mkdtemp(
      join(artifactRoot, "marketing-preferences-timeout-")
    );
    let child: Bun.Subprocess | undefined;
    const originalSpawn = Bun.spawn.bind(Bun);
    const spawn = spyOn(Bun, "spawn").mockImplementation((command, options) => {
      child = originalSpawn(command, options);
      return child;
    });

    try {
      await expect(
        compileMarketingPreferencesFixture({
          appRoot,
          outputDirectory: join(directory, "output"),
          timeoutMs: 1,
        })
      ).rejects.toThrow(
        "Marketing preferences fixture child timed out after 1ms"
      );

      expect(spawn).toHaveBeenCalledTimes(1);
      const launchedChild = child;
      expect(launchedChild).toBeDefined();
      if (launchedChild === undefined) return;
      expect(launchedChild.pid).toBeGreaterThan(0);
      expect(launchedChild.killed).toBe(true);
      expect(await launchedChild.exited).not.toBe(0);
    } finally {
      spawn.mockRestore();
      await child?.exited.catch(() => undefined);
      await rm(directory, { force: true, recursive: true });
    }
  }
);

test.serial(
  "rejects malformed fixture-child stdout without leaking its raw sentinel",
  async () => {
    await mkdir(artifactRoot, { recursive: true });
    const directory = await mkdtemp(
      join(artifactRoot, "marketing-preferences-malformed-stdout-")
    );
    const rawSentinel = "synthetic-malformed-stdout-sentinel";
    try {
      await withMockedFixtureChild(
        fixtureChildScript(rawSentinel),
        async () => {
          let thrown: unknown;
          try {
            await compileMarketingPreferencesFixture({
              appRoot,
              outputDirectory: join(directory, "output"),
            });
          } catch (cause) {
            thrown = cause;
          }

          expect(errorMessage(thrown)).toBe(
            "Marketing preferences fixture child returned malformed JSON"
          );
          expect(errorMessage(thrown)).not.toContain(rawSentinel);
        }
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }
);

test.serial(
  "rejects a nonzero fixture child even with a valid success response",
  async () => {
    await mkdir(artifactRoot, { recursive: true });
    const directory = await mkdtemp(
      join(artifactRoot, "marketing-preferences-nonzero-")
    );
    try {
      const outputDirectory = join(directory, "output");
      const result = await writeMockFixtureOutputs(outputDirectory);
      await withMockedFixtureChild(
        fixtureChildScript(JSON.stringify(result), 23),
        async () => {
          await expect(
            compileMarketingPreferencesFixture({
              appRoot,
              outputDirectory,
            })
          ).rejects.toThrow(
            "Marketing preferences fixture child exited with code 23"
          );
        }
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }
);

test.serial(
  "rejects a fixture child success response whose JavaScript path escapes",
  async () => {
    await mkdir(artifactRoot, { recursive: true });
    const directory = await mkdtemp(
      join(artifactRoot, "marketing-preferences-path-containment-")
    );
    const rawSentinel = "synthetic-escaping-javascript-path";
    try {
      const outputDirectory = join(directory, "output");
      const result = await writeMockFixtureOutputs(outputDirectory);
      const escapingJavascriptPath = join(directory, `${rawSentinel}.js`);
      await writeFile(
        escapingJavascriptPath,
        "const outside = true;\n",
        "utf8"
      );
      await withMockedFixtureChild(
        fixtureChildScript(
          JSON.stringify({ ...result, javascriptPath: escapingJavascriptPath })
        ),
        async () => {
          let thrown: unknown;
          try {
            await compileMarketingPreferencesFixture({
              appRoot,
              outputDirectory,
            });
          } catch (cause) {
            thrown = cause;
          }

          expect(errorMessage(thrown)).toBe(
            "Marketing preferences JavaScript output path escapes the output directory"
          );
          expect(errorMessage(thrown)).not.toContain(rawSentinel);
        }
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }
);

test.serial(
  "rejects fixture-child stdout overflow without leaking its raw sentinel",
  async () => {
    await mkdir(artifactRoot, { recursive: true });
    const directory = await mkdtemp(
      join(artifactRoot, "marketing-preferences-stdout-overflow-")
    );
    const rawSentinel = "synthetic-stdout-overflow-sentinel";
    try {
      await withMockedFixtureChild(
        `process.stdout.write("x".repeat(${64 * 1024 + 1}) + ${JSON.stringify(rawSentinel)});`,
        async () => {
          let thrown: unknown;
          try {
            await compileMarketingPreferencesFixture({
              appRoot,
              outputDirectory: join(directory, "output"),
            });
          } catch (cause) {
            thrown = cause;
          }

          expect(errorMessage(thrown)).toBe(
            "Marketing preferences fixture child stdout failed"
          );
          expect(errorMessage(thrown)).not.toContain(rawSentinel);
        }
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }
);

test.serial("sanitizes a structured fixture-child error response", async () => {
  await mkdir(artifactRoot, { recursive: true });
  const directory = await mkdtemp(
    join(artifactRoot, "marketing-preferences-structured-error-")
  );
  const rawValues = [
    "synthetic-structured-password",
    "synthetic-structured-query",
    "synthetic-structured-environment",
  ];
  try {
    const structuredMessage =
      `https://synthetic-user:${rawValues[0]}@example.test/?token=${rawValues[1]}\n` +
      `DATABASE_URL=${rawValues[2]}`;
    await withMockedFixtureChild(
      fixtureChildScript(
        JSON.stringify({ message: structuredMessage, status: "error" }),
        1
      ),
      async () => {
        let thrown: unknown;
        try {
          await compileMarketingPreferencesFixture({
            appRoot,
            outputDirectory: join(directory, "output"),
          });
        } catch (cause) {
          thrown = cause;
        }

        const message = errorMessage(thrown);
        expect(message).toContain(
          "https://[REDACTED]@example.test/?token=[REDACTED]"
        );
        expect(message).toContain("DATABASE_URL=[REDACTED]");
        for (const rawValue of rawValues) {
          expect(message).not.toContain(rawValue);
        }
      }
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test.serial(
  "compiles the marketing preferences fixture in an isolated child process",
  async () => {
    await mkdir(artifactRoot, { recursive: true });
    const outputDirectory = await mkdtemp(
      join(artifactRoot, "marketing-preferences-child-boundary-")
    );
    const parentBuild = spyOn(Bun, "build").mockImplementation(async () => {
      throw new AggregateError(
        [
          {
            message:
              "parent DATABASE_URL=synthetic-parent-compiler-fault should never be observed",
            position: {
              column: 2,
              file: "https://synthetic-user:synthetic-password@example.test/parent.tsx?token=synthetic-query-value",
              line: 7,
            },
          },
        ],
        "synthetic parent compiler fault"
      );
    });

    try {
      const fixture = await compileMarketingPreferencesFixture({
        appRoot,
        outputDirectory,
      });
      const javascript = await readFile(fixture.javascriptPath, "utf8");
      const css = await readFile(fixture.cssPath);
      const schedulerStats = await stat(fixture.scheduler.path);
      const schedulerBytes = await readFile(fixture.scheduler.path);
      const schedulerMarker = "unstable_scheduleCallback";
      const schedulerSource = await readFile(
        join(appRoot, "node_modules/scheduler/cjs/scheduler.production.js"),
        "utf8"
      );

      expect(parentBuild).not.toHaveBeenCalled();
      expect(schedulerStats.isFile()).toBe(true);
      expect(schedulerBytes.byteLength).toBe(fixture.scheduler.bytes);
      expect(schedulerSource).toContain(schedulerMarker);
      expect(javascript).toContain(schedulerMarker);
      expect(css.byteLength).toBeGreaterThan(0);
    } finally {
      parentBuild.mockRestore();
      await rm(outputDirectory, { force: true, recursive: true });
    }
  }
);

test.serial.skipIf(!chromiumAvailable)(
  "renders marketing preference states and exercises controlled browser flows",
  async () => {
    await rm(artifactRoot, { force: true, recursive: true });
    await mkdir(artifactRoot, { recursive: true });
    const bundle = await compileMarketingPreferencesFixture({
      appRoot,
      outputDirectory: artifactRoot,
    });
    const staticServer = await serveBundle(bundle);
    const problems: BrowserProblems = {
      consoleErrors: [],
      externalRequests: [],
      pageErrors: [],
    };
    const screenshots: ScreenshotEvidence[] = [];
    const logLines: string[] = [
      "scope=component-only controlled renderer",
      "authorization=not-proved",
      "cookies=not-proved",
      "tokens=not-proved",
      `server=${staticServer.baseUrl} (ephemeral localhost port)`,
    ];
    try {
      browser = await chromium.launch({ headless: true, timeout: 20_000 });
      for (const locale of locales) {
        for (const viewport of viewports) {
          for (const scenario of scenarios) {
            const evidence = await runInitialCapture({
              baseUrl: staticServer.baseUrl,
              locale,
              problems,
              scenario,
              viewport,
            });
            screenshots.push(evidence);
            logLines.push(
              `${evidence.phase} ${locale}/${viewport.name}/${scenario} ${evidence.screenshot}`
            );
          }
          if (viewport.name === "320") {
            await runAccountsDisabledChecks({
              baseUrl: staticServer.baseUrl,
              locale,
              problems,
              viewport,
            });
          }
          for (const evidence of await runPendingTransitions({
            baseUrl: staticServer.baseUrl,
            locale,
            problems,
            viewport,
          })) {
            screenshots.push(evidence);
            logLines.push(
              `${evidence.phase} ${locale}/${viewport.name}/${evidence.scenario} ${evidence.screenshot}`
            );
          }
          for (const scenario of [
            "account-absent",
            "account-active",
            "account-withdrawn",
          ] as const) {
            for (const evidence of await runSaveTransitions({
              baseUrl: staticServer.baseUrl,
              locale,
              problems,
              scenario,
              viewport,
            })) {
              screenshots.push(evidence);
              logLines.push(
                `${evidence.phase} ${locale}/${viewport.name}/${evidence.scenario} ${evidence.screenshot}`
              );
            }
          }
          for (const evidence of await runLinkClearTransitions({
            baseUrl: staticServer.baseUrl,
            locale,
            problems,
            viewport,
          })) {
            screenshots.push(evidence);
            logLines.push(
              `${evidence.phase} ${locale}/${viewport.name}/${evidence.scenario} ${evidence.screenshot}`
            );
          }
          for (const evidence of await runContextReplacement({
            baseUrl: staticServer.baseUrl,
            locale,
            problems,
            viewport,
          })) {
            screenshots.push(evidence);
            logLines.push(
              `${evidence.phase} ${locale}/${viewport.name}/${evidence.scenario} ${evidence.screenshot}`
            );
          }
        }
      }
      expect(problems.externalRequests).toEqual([]);
      expect(problems.pageErrors).toEqual([]);
      expect(problems.consoleErrors).toEqual([]);
      expect(screenshots).toHaveLength(126);
      expect(
        screenshots.every(
          ({ geometry }) =>
            geometry.documentScrollWidth <= geometry.viewport.width + 1 &&
            geometry.bodyScrollWidth <= geometry.viewport.width + 1 &&
            geometry.offenders.length === 0
        )
      ).toBe(true);

      const report = {
        schemaVersion: 1,
        status: "passed",
        scope: {
          kind: "component-only-controlled-renderer",
          authorization: "not-proved",
          backend: "not-proved",
          cookieState: "not-proved",
          externalNetwork: "blocked-and-none-observed",
          tokenState: "not-proved",
        },
        renderer: {
          adapter: relative(repoRoot, adapterPath),
          productionComponent: relative(repoRoot, productionFormPath),
          productionCopy: relative(repoRoot, productionCopyPath),
          controlledModules: [
            "@/features/legal/actions",
            "@/shared/utils/use-workspace-action",
          ],
          bundle: {
            entry: relative(repoRoot, bundle.entryPath),
            javascript: relative(repoRoot, bundle.javascriptPath),
            css: relative(repoRoot, bundle.cssPath),
          },
        },
        browser: {
          engine: "Chromium",
          version: browser?.version() ?? "unknown",
          bunVersion: Bun.version,
          viewports,
          locales,
        },
        syntheticScenarios: scenarios,
        checks: {
          pendingContinue: true,
          managedStatuses: ["absent", "active", "withdrawn"],
          explicitConfirmation: true,
          successAndError: true,
          invalidAndUnavailable: true,
          accountsDisabledHidesSignInAndKeepsPendingLink: true,
          dismissalContextForClear: true,
          linkAndAccountSourceCopy: true,
          contextReplacementResetsConfirmation: true,
          noHorizontalOverflow: true,
          keyboardAccessibleLabels: true,
        },
        problems,
        screenshots,
      };
      await writeFile(
        join(artifactRoot, "report.json"),
        `${JSON.stringify(report, null, 2)}\n`,
        "utf8"
      );
      await writeFile(
        join(artifactRoot, "browser.log"),
        `${logLines.join("\n")}\n`,
        "utf8"
      );
    } finally {
      const runningBrowser = browser;
      try {
        try {
          await staticServer.server.stop(true);
        } finally {
          await writeFile(
            join(artifactRoot, "browser.log"),
            `${logLines.join("\n")}\n`,
            "utf8"
          );
        }
      } finally {
        browser = undefined;
        await runningBrowser?.close();
      }
    }
  },
  300_000
);
