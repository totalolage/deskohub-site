import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  access,
  constants,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, extname, join, relative, resolve } from "node:path";
import {
  type Browser,
  type BrowserContext,
  chromium,
  type Page,
} from "@playwright/test";
import { marketingPreferencesFormCopy } from "../../features/legal/components/marketing-preferences-form.copy";

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
const globalsCssPath = join(appRoot, "app/globals.css");
const regularFontPath = join(appRoot, "assets/fonts/Sculpin/regular.woff2");
const italicFontPath = join(appRoot, "assets/fonts/Sculpin/italic.woff2");
const nextNavigationStubPath = join(
  import.meta.dir,
  "stubs/next-navigation.ts"
);
const appRequire = createRequire(join(appRoot, "package.json"));

const chromiumAvailable = await access(
  chromium.executablePath(),
  constants.X_OK
)
  .then(() => true)
  .catch(() => false);

let browser: Browser | undefined;

beforeAll(async () => {
  if (!chromiumAvailable) return;
  browser = await chromium.launch({ headless: true, timeout: 20_000 });
});

afterAll(async () => {
  const runningBrowser = browser;
  browser = undefined;
  await runningBrowser?.close();
});

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

type BuildOutput = { readonly path: string };
type BuildResult = {
  readonly logs?: readonly { readonly message: string }[];
  readonly outputs: readonly BuildOutput[];
  readonly success: boolean;
};

const controlledActionsSource = `
type ActionName = "clear" | "confirm" | "save";
type ActionInput = Record<string, unknown>;
type ActionResult = {
  readonly data?: unknown;
  readonly validationErrors?: unknown;
};
type ActionLog = { readonly events: Array<{ action: ActionName; input: ActionInput }> };
type ControlledGlobal = typeof globalThis & {
  readonly __marketingPreferencesActionLog?: ActionLog;
};

const scope = globalThis as ControlledGlobal;
const actionLog = scope.__marketingPreferencesActionLog ?? { events: [] };
if (scope.__marketingPreferencesActionLog === undefined) {
  Object.defineProperty(scope, "__marketingPreferencesActionLog", {
    configurable: false,
    enumerable: false,
    value: actionLog,
    writable: false,
  });
}

const outcomeFor = (action: ActionName) => {
  const params = new URLSearchParams(globalThis.location.search);
  return (params.get(action + "Outcome") ?? params.get("outcome")) === "error"
    ? "error"
    : "success";
};

const delayFor = () => {
  const value = Number.parseInt(
    new URLSearchParams(globalThis.location.search).get("delay") ?? "24",
    10
  );
  return Number.isFinite(value) && value >= 0 ? value : 24;
};

const execute = async (action: ActionName, input: ActionInput): Promise<ActionResult> => {
  actionLog.events.push({ action, input });
  await new Promise<void>((resolve) => setTimeout(resolve, delayFor()));
  if (outcomeFor(action) === "error") {
    return { validationErrors: { controlled: true } };
  }
  return { data: { status: action + "-complete" } };
};

export const clearMarketingManagementAction = (input: ActionInput) =>
  execute("clear", input);
export const confirmMarketingManagementAction = (input: ActionInput) =>
  execute("confirm", input);
export const saveMarketingPreferencesAction = (input: ActionInput) =>
  execute("save", input);
`;

const controlledHookSource = `
import { useState } from "react";

type ActionResult = {
  readonly data?: unknown;
  readonly serverError?: string;
  readonly validationErrors?: unknown;
};
type Action = (input: Record<string, unknown>) => Promise<ActionResult>;
type ActionOptions = {
  readonly onError?: (args: { readonly error: unknown }) => void;
  readonly onSuccess?: (args: { readonly data?: unknown }) => void;
  readonly onTransportError?: (args: {
    readonly error: unknown;
    readonly input: unknown;
  }) => void;
};

export function useWorkspaceAction(action: Action, options: ActionOptions) {
  const [result, setResult] = useState<ActionResult>({});
  const [isExecuting, setIsExecuting] = useState(false);

  const reset = () => setResult({});
  const executeAsync = async (input: Record<string, unknown>) => {
    setIsExecuting(true);
    try {
      const nextResult = await action(input);
      setResult(nextResult);
      setIsExecuting(false);
      if (nextResult.serverError || nextResult.validationErrors) {
        options.onError?.({ error: nextResult });
      } else {
        options.onSuccess?.({ data: nextResult.data });
      }
      return nextResult;
    } catch (error) {
      setIsExecuting(false);
      options.onTransportError?.({ error, input });
      throw error;
    }
  };
  const execute = (input: Record<string, unknown>) => {
    void executeAsync(input).catch(() => undefined);
  };

  return { execute, executeAsync, isExecuting, reset, result };
}
`;

const fileExists = async (path: string) =>
  Bun.file(path)
    .exists()
    .catch(() => false);

const resolveModulePath = async (basePath: string) => {
  const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
  const candidates = [
    basePath,
    ...extensions.map((extension) => `${basePath}${extension}`),
    ...extensions.map((extension) => join(basePath, `index${extension}`)),
  ];
  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }
  throw new Error(`Could not resolve app module ${basePath}`);
};

const makeEntry = () => `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import ${JSON.stringify(globalsCssPath)};
import Adapter, { accountVisualAdapterMetadata } from ${JSON.stringify(adapterPath)};

const root = document.getElementById("marketing-preferences-browser-root");
if (!root) throw new Error("Marketing preferences browser root is missing");
const locale = new URLSearchParams(window.location.search).get("locale") === "cs-CZ" ? "cs-CZ" : "en-US";
createRoot(root).render(
  createElement(
    "div",
    {
      "data-account-visual-adapter-fixture": accountVisualAdapterMetadata.fixture,
      "data-account-visual-adapter-owner": accountVisualAdapterMetadata.owner,
      "data-account-visual-mode": "component-only",
      "data-account-visual-ready": "true",
      "data-account-visual-screen": "legal",
    },
    createElement(Adapter, { locale, screen: "legal" })
  )
);
`;

const makeBuildPlugin = (): Bun.BunPlugin => {
  const virtualNamespace = "marketing-preferences-controlled-renderer";
  const actionModulePath = "controlled-actions";
  const hookModulePath = "controlled-hook";

  return {
    name: "marketing-preferences-controlled-renderer",
    setup(build) {
      build.onResolve({ filter: /^@\/features\/legal\/actions$/ }, () => ({
        namespace: virtualNamespace,
        path: actionModulePath,
      }));
      build.onResolve(
        { filter: /^@\/shared\/utils\/use-workspace-action$/ },
        () => ({ namespace: virtualNamespace, path: hookModulePath })
      );
      build.onResolve({ filter: /^next\/navigation$/ }, () => ({
        path: nextNavigationStubPath,
      }));
      build.onLoad(
        { filter: /^controlled-actions$/, namespace: virtualNamespace },
        () => ({ contents: controlledActionsSource, loader: "ts" })
      );
      build.onLoad(
        { filter: /^controlled-hook$/, namespace: virtualNamespace },
        () => ({ contents: controlledHookSource, loader: "ts" })
      );
      build.onResolve({ filter: /^@\// }, async (args) => ({
        path: await resolveModulePath(join(appRoot, args.path.slice(2))),
      }));
      build.onResolve(
        { filter: /^(?!@\/)(?!node:)(?:@[^/]+\/)?[^./]/ },
        (args) => {
          try {
            return { path: appRequire.resolve(args.path) };
          } catch {
            return undefined;
          }
        }
      );
      build.onLoad({ filter: /\/app\/globals\.css$/ }, async (args) => {
        if (resolve(args.path) !== globalsCssPath) return undefined;
        const postcss = await import("postcss");
        const loadPostCssConfig = await import("postcss-load-config");
        const config = await loadPostCssConfig.default({}, appRoot);
        const source = await readFile(globalsCssPath, "utf8");
        const transformed = await postcss
          .default(config.plugins)
          .process(source, {
            from: globalsCssPath,
          });
        return {
          contents: transformed.css,
          loader: "css",
          resolveDir: appRoot,
        };
      });
    },
  };
};

const buildBundle = async () => {
  const buildDirectory = join(artifactRoot, "build");
  await mkdir(buildDirectory, { recursive: true });
  const entryPath = join(artifactRoot, "entry.tsx");
  await writeFile(entryPath, makeEntry(), "utf8");
  let result: BuildResult;
  try {
    result = (await Bun.build({
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      entrypoints: [entryPath],
      format: "esm",
      minify: false,
      outdir: buildDirectory,
      plugins: [makeBuildPlugin()],
      sourcemap: "none",
      target: "browser",
    })) as BuildResult;
  } catch (error) {
    throw new Error(
      `Marketing preferences browser bundle threw: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error }
    );
  }
  if (!result.success) {
    throw new Error(
      [
        "Marketing preferences browser bundle failed",
        ...(result.logs?.map(({ message }) => message) ?? []),
      ].join("\n")
    );
  }
  const outputPaths = result.outputs.map((output) =>
    resolve(buildDirectory, output.path)
  );
  const javascriptPath = outputPaths.find((path) => extname(path) === ".js");
  const cssPath = outputPaths.find((path) => extname(path) === ".css");
  if (!javascriptPath || !cssPath) {
    throw new Error(
      "Marketing preferences browser bundle did not emit JavaScript and CSS"
    );
  }
  return { cssPath, entryPath, javascriptPath } as const;
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

const serveBundle = async (bundle: Awaited<ReturnType<typeof buildBundle>>) => {
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

test.serial.skipIf(!chromiumAvailable)(
  "renders marketing preference states and exercises controlled browser flows",
  async () => {
    await rm(artifactRoot, { force: true, recursive: true });
    await mkdir(artifactRoot, { recursive: true });
    const bundle = await buildBundle();
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
      await staticServer.server.stop(true);
      await writeFile(
        join(artifactRoot, "browser.log"),
        `${logLines.join("\n")}\n`,
        "utf8"
      );
    }
  },
  300_000
);
