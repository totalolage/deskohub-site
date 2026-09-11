import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import {
  type Browser,
  type BrowserContext,
  chromium,
  type Page,
} from "@playwright/test";
import postcss from "postcss";
import loadPostCssConfig from "postcss-load-config";

const repoRoot = resolve(import.meta.dir, "../../../..");
const appRoot = resolve(import.meta.dir, "../..");
const artifactRoot = join(repoRoot, ".artifacts/account-sticky");
const productionBuildRoot = join(artifactRoot, "build-production");
const regressionBuildRoot = join(artifactRoot, "build-nonsticky");
const browserEntryPath = join(import.meta.dir, "browser-entry.tsx");
const accountShellPath = join(
  appRoot,
  "features/account/components/shell/account-shell.tsx"
);
const accountFramePath = join(
  appRoot,
  "features/account/components/shell/account-frame.tsx"
);
const globalsCssPath = join(appRoot, "app/globals.css");
const postCssConfigPath = join(appRoot, "postcss.config.mjs");
const appRequire = createRequire(join(appRoot, "package.json"));
const regressionAccountFramePath = join(
  regressionBuildRoot,
  "account-frame-nonsticky.tsx"
);
const rendererPort = 3163;
const baseUrl = `http://localhost:${rendererPort}`;
const stickyGapPx = 16;
const desktopWidths = [1440, 1024] as const;
const mobileWidths = [320, 375, 480] as const;
const mobileLocales = ["en-US", "cs-CZ"] as const;
const contentVariants = ["short", "tall"] as const;
const sidebarVariants = ["normal", "tall"] as const;
const scrollPositions = ["top", "middle", "bottom"] as const;
const accountAsideStickyClasses =
  "sticky top-(--site-header-height) z-40 min-w-0 md:sticky md:top-[calc(var(--site-header-height)+1rem)] md:max-h-[calc(100dvh-var(--site-header-height)-2rem)] md:overflow-y-auto";

type ContentVariant = (typeof contentVariants)[number];
type FixtureLocale = (typeof mobileLocales)[number];
type SidebarVariant = (typeof sidebarVariants)[number];
type ScrollPosition = (typeof scrollPositions)[number];
type BuildKind = "production" | "nonsticky";
type FocusTraversalPosition = "initial" | "parent-constrained";

const focusTraversalPlans = [
  { label: "initial", scrollPosition: "top" },
  { label: "parent-constrained", scrollPosition: "bottom" },
] as const satisfies ReadonlyArray<{
  readonly label: FocusTraversalPosition;
  readonly scrollPosition: ScrollPosition;
}>;

type BuildFile = {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
};

type BuildResult = {
  readonly kind: BuildKind;
  readonly directory: string;
  readonly javascriptPath: string;
  readonly cssPath: string;
  readonly outputs: readonly BuildFile[];
};

type Rect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly right: number;
  readonly bottom: number;
};

type ComputedBoxStyle = {
  readonly borderBottomWidth: string;
  readonly borderLeftWidth: string;
  readonly borderRightWidth: string;
  readonly borderRadius: string;
  readonly borderTopWidth: string;
  readonly display: string;
  readonly overflowX: string;
  readonly padding: string;
  readonly scrollSnapType: string;
  readonly visibility: string;
};

type Geometry = {
  readonly viewport: { readonly width: number; readonly height: number };
  readonly scroll: {
    readonly x: number;
    readonly y: number;
    readonly maxY: number;
    readonly documentHeight: number;
    readonly documentWidth: number;
    readonly bodyWidth: number;
  };
  readonly header: Rect;
  readonly aside: Rect;
  readonly content: Rect;
  readonly navigation: Rect;
  readonly parent: Rect;
  readonly pageFooter: Rect;
  readonly sidebarFooter: Rect | null;
  readonly mobileNavigation: Rect;
  readonly mobileNavigationScroll: {
    readonly clientWidth: number;
    readonly scrollLeft: number;
    readonly scrollWidth: number;
  };
  readonly mobileLegend: {
    readonly accessibleNameReference: string | null;
    readonly className: string;
    readonly id: string;
    readonly rect: Rect;
    readonly text: string;
    readonly style: ComputedBoxStyle;
  };
  readonly mobileNavigationStyle: ComputedBoxStyle;
  readonly mobileFieldsetStyle: ComputedBoxStyle;
  readonly navigationStyle: ComputedBoxStyle;
  readonly asideStyle: {
    readonly top: string;
    readonly position: string;
    readonly overflowY: string;
    readonly maxHeight: string;
    readonly scrollTop: number;
    readonly scrollHeight: number;
    readonly clientHeight: number;
  };
};

type FocusTarget = {
  readonly id: string;
  readonly label: string;
  readonly tag: string;
};

type FocusEvidence = {
  readonly traversals: readonly FocusTraversalEvidence[];
};

type FocusStepEvidence = {
  readonly asideRect: Rect;
  readonly asideScrollTop: number;
  readonly headerBottom: number;
  readonly isNavOrFooterControl: boolean;
  readonly pageScrollY: number;
  readonly rect: Rect;
  readonly target: FocusTarget;
  readonly viewportHeight: number;
};

type FocusTraversalEvidence = {
  readonly asideMaxScrollTop: number;
  readonly asideRect: Rect;
  readonly asideScrollTopAfter: number;
  readonly asideScrollTopBefore: number;
  readonly failures: readonly string[];
  readonly final: FocusTarget | null;
  readonly finalRect: Rect | null;
  readonly label: "initial" | "parent-constrained";
  readonly sequence: readonly FocusTarget[];
  readonly start: Geometry;
  readonly steps: readonly FocusStepEvidence[];
};

type MobilePositionEvidence = {
  readonly geometry: Geometry;
  readonly expectedStickyTop: number;
  readonly position: ScrollPosition;
  readonly screenshot: string;
};

type MobileNavigationState = {
  readonly activeLabel: string;
  readonly activeRect: Rect;
  readonly activeSection: string;
  readonly stripRect: Rect;
  readonly stripScrollLeft: number;
  readonly stripScrollWidth: number;
};

type MobileNavigationEvidence = {
  readonly accessibleGroupCount: number;
  readonly afterSectionChange: MobileNavigationState;
  readonly failures: readonly string[];
  readonly initial: MobileNavigationState;
  readonly legendText: string;
};

type FocusCheckResult = {
  readonly evidence: FocusEvidence;
  readonly failures: readonly string[];
};

type MobileScenarioEvidence = {
  readonly scenario: Scenario;
  readonly status: "passed" | "failed";
  readonly initial: Geometry | null;
  readonly navigation: MobileNavigationEvidence | null;
  readonly positions: readonly MobilePositionEvidence[];
  readonly sectionChangeScreenshot: string | null;
  readonly sidebarFooterScrollY: number | null;
  readonly pageFooterScrollY: number | null;
  readonly screenshot: string | null;
  readonly failures: readonly string[];
};

type Scenario = {
  readonly locale: FixtureLocale;
  readonly width: number;
  readonly height: number;
  readonly content: ContentVariant;
  readonly sidebar: SidebarVariant;
};

type DesktopPositionEvidence = {
  readonly position: ScrollPosition;
  readonly geometry: Geometry;
  readonly expectedStickyTop: number;
  readonly expectedParentConstrainedBottom: number;
  readonly screenshot: string;
};

type DesktopScenarioEvidence = {
  readonly scenario: Scenario;
  readonly status: "passed" | "failed";
  readonly positions: readonly DesktopPositionEvidence[];
  readonly focus: FocusEvidence | null;
  readonly sidebarEndScreenshot: string | null;
  readonly pageFooterScrollY: number | null;
  readonly failures: readonly string[];
};

type SourceHashes = {
  readonly accountFrame: BuildFile;
  readonly accountShell: BuildFile;
  readonly globalsCss: BuildFile;
  readonly postCssConfig: BuildFile;
  readonly fixtureEntry: BuildFile;
  readonly runner: BuildFile;
  readonly nonstickyOverride: BuildFile;
};

type GeometryReport = {
  readonly schemaVersion: 3;
  readonly scope: {
    readonly kind: "isolated-production-component-fixture";
    readonly routeE2E: false;
    readonly syntheticSiteHeader: true;
    readonly syntheticPageFooter: true;
    readonly realSiteHeaderHeight: "6rem";
    readonly browserServer: `localhost:${typeof rendererPort}`;
  };
  readonly browser: {
    readonly engine: "Chromium";
    readonly version: string;
    readonly bunVersion: string;
  };
  readonly matrix: {
    readonly desktopLocales: readonly FixtureLocale[];
    readonly desktopPositions: number;
    readonly desktopScenarios: number;
    readonly mobileLocales: readonly FixtureLocale[];
    readonly mobilePositions: number;
    readonly mobileScenarios: number;
    readonly mobileSectionChangeScreenshots: number;
    readonly mobileWidths: readonly number[];
  };
  readonly sourceHashes: SourceHashes;
  readonly builds: {
    readonly production: BuildResult;
    readonly nonsticky: BuildResult;
  };
  readonly desktop: readonly DesktopScenarioEvidence[];
  readonly mobile: readonly MobileScenarioEvidence[];
  readonly regression: {
    readonly status: "passed" | "failed";
    readonly observedFailure: string | null;
  };
  readonly failures: readonly string[];
};

type BuildOutput = { readonly path: string };
type BunBuildResult = {
  readonly success: boolean;
  readonly outputs: readonly BuildOutput[];
  readonly logs?: readonly { readonly message: string }[];
};

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

const displayPath = (filePath: string) => {
  const path = relative(repoRoot, filePath);
  return path === "" || path.startsWith("..") ? filePath : path;
};

const fileExists = async (filePath: string) => {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
};

const describeFile = async (filePath: string): Promise<BuildFile> => {
  const bytes = await readFile(filePath);
  return {
    bytes: bytes.byteLength,
    path: displayPath(filePath),
    sha256: sha256(bytes),
  };
};

const resolveModulePath = async (basePath: string): Promise<string> => {
  const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
  const candidates = [
    basePath,
    ...extensions.map((extension) => `${basePath}${extension}`),
    ...extensions.map((extension) => join(basePath, `index${extension}`)),
  ];
  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }
  throw new Error(`Could not resolve module: ${basePath}`);
};

const makeBuildPlugin = (
  accountShellAlias: string,
  nonsticky: boolean
): Bun.BunPlugin => ({
  name: "account-sticky-tailwind-postcss",
  setup(build) {
    build.onResolve({ filter: /^@\// }, async (args) => {
      if (args.path === "@/features/account/components/shell/account-shell") {
        return { path: accountShellAlias };
      }
      return {
        path: await resolveModulePath(join(appRoot, args.path.slice(2))),
      };
    });
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
    build.onLoad({ filter: /\/account-frame\.tsx$/ }, async (args) => {
      if (!nonsticky || resolve(args.path) !== accountFramePath)
        return undefined;
      const source = await readFile(regressionAccountFramePath, "utf8");
      return {
        contents: source,
        loader: "tsx",
        resolveDir: dirname(accountFramePath),
      };
    });
    build.onLoad({ filter: /\/app\/globals\.css$/ }, async (args) => {
      if (resolve(args.path) !== globalsCssPath) return undefined;
      const config = await loadPostCssConfig({}, appRoot);
      const source = await readFile(globalsCssPath, "utf8");
      const transformed = await postcss(config.plugins).process(source, {
        from: globalsCssPath,
      });
      return {
        contents: transformed.css,
        loader: "css",
        resolveDir: appRoot,
      };
    });
  },
});

const buildBundle = async (
  kind: BuildKind,
  directory: string,
  accountShellAlias: string
): Promise<BuildResult> => {
  await mkdir(directory, { recursive: true });
  let result: BunBuildResult;
  try {
    result = (await Bun.build({
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      entrypoints: [browserEntryPath],
      format: "esm",
      minify: false,
      outdir: directory,
      plugins: [makeBuildPlugin(accountShellAlias, kind === "nonsticky")],
      sourcemap: "none",
      target: "browser",
    })) as BunBuildResult;
  } catch (error) {
    const details =
      error instanceof Error
        ? `${error.stack ?? error.message}\n${JSON.stringify(
            error,
            Object.getOwnPropertyNames(error)
          )}`
        : String(error);
    throw new Error(`Account sticky ${kind} bundle threw: ${details}`);
  }
  if (!result.success) {
    const details = result.logs?.map((log) => log.message).join("\n");
    throw new Error(
      [`Account sticky ${kind} bundle failed to build`, details]
        .filter(Boolean)
        .join("\n")
    );
  }

  const outputPaths = result.outputs.map((output) =>
    isAbsolute(output.path) ? output.path : resolve(directory, output.path)
  );
  const javascriptPath = outputPaths.find((path) => extname(path) === ".js");
  const cssPath = outputPaths.find((path) => extname(path) === ".css");
  if (!javascriptPath || !cssPath) {
    throw new Error(
      `Account sticky ${kind} bundle did not emit both JavaScript and CSS`
    );
  }

  const outputs = await Promise.all(
    outputPaths.sort().map(async (path): Promise<BuildFile> => {
      const bytes = await readFile(path);
      return {
        bytes: bytes.byteLength,
        path: relative(artifactRoot, path),
        sha256: sha256(bytes),
      };
    })
  );
  return { cssPath, directory, javascriptPath, kind, outputs };
};

const writeNonstickyOverride = async () => {
  const source = await readFile(accountFramePath, "utf8");
  if (!source.includes(accountAsideStickyClasses)) {
    throw new Error(
      "AccountShell sticky class was not found; the isolated regression override cannot be built"
    );
  }
  await mkdir(regressionBuildRoot, { recursive: true });
  await writeFile(
    regressionAccountFramePath,
    source.replace(accountAsideStickyClasses, "min-w-0"),
    "utf8"
  );
};

const makeHtml = (javascriptPath: string, cssPath: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Account sticky geometry fixture</title>
    <link rel="stylesheet" href="/${basename(cssPath)}">
  </head>
  <body>
    <div id="account-sticky-root"></div>
    <script type="module" src="/${basename(javascriptPath)}"></script>
  </body>
</html>
`;

const serveBuild = async (build: BuildResult) => {
  const javascript = await readFile(build.javascriptPath);
  const css = await readFile(build.cssPath);
  const assets = new Map<
    string,
    { readonly body: Uint8Array; readonly type: string }
  >([
    [
      `/${basename(build.javascriptPath)}`,
      { body: javascript, type: "text/javascript; charset=utf-8" },
    ],
    [
      `/${basename(build.cssPath)}`,
      { body: css, type: "text/css; charset=utf-8" },
    ],
  ]);
  const html = makeHtml(build.javascriptPath, build.cssPath);
  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({
      fetch(request) {
        if (request.method !== "GET") {
          return new Response(null, { status: 405 });
        }
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
      hostname: "localhost",
      port: rendererPort,
    });
  } catch (error) {
    throw new Error(
      `Account sticky fixture requires exclusive localhost:${rendererPort}; no existing process was stopped. ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  return { baseUrl, server } as const;
};

const createContext = async (
  browser: Browser,
  scenario: Scenario,
  problems: string[]
) => {
  const context = await browser.newContext({
    deviceScaleFactor: 1,
    locale: scenario.locale,
    reducedMotion: "reduce",
    viewport: scenario,
  });
  await context.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin !== baseUrl) {
      problems.push(`blocked external request: ${requestUrl.origin}`);
      await route.abort();
      return;
    }
    await route.continue();
  });
  return context;
};

const loadFixture = async (
  page: Page,
  scenario: Scenario,
  problems: string[],
  expectedPosition: "sticky" | "static" = "sticky"
) => {
  page.on("pageerror", (error) =>
    problems.push(`page error: ${error.message}`)
  );
  page.on("console", (message) => {
    if (message.type() === "error")
      problems.push(`console error: ${message.text()}`);
  });
  const url = `${baseUrl}/?content=${scenario.content}&locale=${scenario.locale}&sidebar=${scenario.sidebar}`;
  await page.goto(url, { timeout: 15_000, waitUntil: "load" });
  await page
    .locator("html[data-account-sticky-ready='true']")
    .waitFor({ state: "attached", timeout: 15_000 });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForFunction((expectedPosition) => {
    const header = document.querySelector<HTMLElement>(
      "[data-account-sticky-site-header]"
    );
    const aside = document.querySelector<HTMLElement>("aside");
    const fixture = document.querySelector("[data-account-sticky-fixture]");
    if (!header || !aside || !fixture) return false;
    const rootVariable = getComputedStyle(document.documentElement)
      .getPropertyValue("--site-header-height")
      .trim();
    const headerHeight = Number.parseFloat(getComputedStyle(header).height);
    return (
      rootVariable === "6rem" &&
      Math.abs(headerHeight - 96) <= 1 &&
      getComputedStyle(aside).position === expectedPosition
    );
  }, expectedPosition);
};

const readGeometry = async (page: Page): Promise<Geometry> =>
  page.evaluate(() => {
    const header = document.querySelector<HTMLElement>(
      "[data-account-sticky-site-header]"
    );
    const aside = document.querySelector<HTMLElement>("aside");
    const parent = aside?.parentElement;
    const content = document.querySelector<HTMLElement>(
      "[data-account-sticky-content]"
    );
    const navigation = document.querySelector<HTMLElement>("aside > nav");
    const mobileNavigation = document.querySelector<HTMLElement>(
      "[data-account-mobile-navigation]"
    );
    const mobileFieldset = mobileNavigation?.closest("fieldset");
    const mobileLegend = mobileFieldset?.querySelector<HTMLElement>("legend");
    const pageFooter = document.querySelector<HTMLElement>(
      "[data-account-sticky-page-footer]"
    );
    const sidebarFooter = [
      ...document.querySelectorAll<HTMLElement>(
        "[data-account-sticky-sidebar-footer]"
      ),
    ].find((candidate) => {
      const style = getComputedStyle(candidate);
      const candidateRect = candidate.getBoundingClientRect();
      return (
        style.display !== "none" &&
        candidateRect.width > 0 &&
        candidateRect.height > 0
      );
    });
    if (
      !header ||
      !aside ||
      !content ||
      !navigation ||
      !mobileNavigation ||
      !mobileFieldset ||
      !mobileLegend ||
      !parent ||
      !pageFooter
    ) {
      throw new Error("Account sticky fixture geometry elements are missing");
    }
    const rect = (element: Element) => {
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
    const styleOf = (element: Element): ComputedBoxStyle => {
      const style = getComputedStyle(element);
      return {
        borderBottomWidth: style.borderBottomWidth,
        borderLeftWidth: style.borderLeftWidth,
        borderRightWidth: style.borderRightWidth,
        borderRadius: style.borderRadius,
        borderTopWidth: style.borderTopWidth,
        display: style.display,
        overflowX: style.overflowX,
        padding: style.padding,
        scrollSnapType: style.scrollSnapType,
        visibility: style.visibility,
      };
    };
    const style = getComputedStyle(aside);
    return {
      aside: rect(aside),
      asideStyle: {
        clientHeight: aside.clientHeight,
        maxHeight: style.maxHeight,
        overflowY: style.overflowY,
        position: style.position,
        scrollHeight: aside.scrollHeight,
        scrollTop: aside.scrollTop,
        top: style.top,
      },
      content: rect(content),
      header: rect(header),
      mobileFieldsetStyle: styleOf(mobileFieldset),
      mobileLegend: {
        accessibleNameReference: mobileFieldset.getAttribute("aria-labelledby"),
        className: mobileLegend.className,
        id: mobileLegend.id,
        rect: rect(mobileLegend),
        style: styleOf(mobileLegend),
        text: mobileLegend.textContent?.trim() ?? "",
      },
      mobileNavigation: rect(mobileNavigation),
      mobileNavigationScroll: {
        clientWidth: mobileNavigation.clientWidth,
        scrollLeft: mobileNavigation.scrollLeft,
        scrollWidth: mobileNavigation.scrollWidth,
      },
      mobileNavigationStyle: styleOf(mobileNavigation),
      navigation: rect(navigation),
      navigationStyle: styleOf(navigation),
      pageFooter: rect(pageFooter),
      parent: rect(parent),
      scroll: {
        bodyWidth: document.body.scrollWidth,
        documentHeight: document.documentElement.scrollHeight,
        documentWidth: document.documentElement.scrollWidth,
        maxY: Math.max(
          0,
          document.documentElement.scrollHeight - window.innerHeight
        ),
        x: window.scrollX,
        y: window.scrollY,
      },
      sidebarFooter: sidebarFooter ? rect(sidebarFooter) : null,
      viewport: { height: window.innerHeight, width: window.innerWidth },
    };
  });

const waitForScrollY = async (page: Page, expected: number) => {
  await page.waitForFunction(
    (target) => Math.abs(window.scrollY - target) <= 1,
    expected
  );
};

const scrollPage = async (
  page: Page,
  position: ScrollPosition
): Promise<Geometry> => {
  const target = await page.evaluate((requestedPosition) => {
    const maxY = Math.max(
      0,
      document.documentElement.scrollHeight - window.innerHeight
    );
    let top = maxY;
    if (requestedPosition === "top") top = 0;
    if (requestedPosition === "middle") top = maxY / 2;
    window.scrollTo(0, top);
    return top;
  }, position);
  await waitForScrollY(page, target);
  return readGeometry(page);
};

const waitForAsideScrollTop = async (page: Page, target: number) => {
  await page.waitForFunction((expected) => {
    const aside = document.querySelector<HTMLElement>("aside");
    return aside !== null && Math.abs(aside.scrollTop - expected) <= 1;
  }, target);
};

const scrollAsideTo = async (page: Page, edge: "top" | "bottom") => {
  const target = await page.evaluate((requestedEdge) => {
    const aside = document.querySelector<HTMLElement>("aside");
    if (!aside) throw new Error("Account sticky aside is missing");
    const top =
      requestedEdge === "top" ? 0 : aside.scrollHeight - aside.clientHeight;
    aside.scrollTo(0, top);
    return Math.max(0, top);
  }, edge);
  await waitForAsideScrollTop(page, target);
};

const assertCondition = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const assertWithin = (
  actual: number,
  expected: number,
  message: string,
  tolerance = 1
): void => {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
};

const readMobileNavigation = async (
  page: Page
): Promise<MobileNavigationState> =>
  page.evaluate(() => {
    const strip = document.querySelector<HTMLElement>(
      "[data-account-mobile-navigation]"
    );
    const active = strip?.querySelector<HTMLButtonElement>(
      "button[aria-current='page']"
    );
    if (!strip || !active) {
      throw new Error(
        "Account sticky mobile navigation active button is missing"
      );
    }
    const rect = (element: Element): Rect => {
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
    const stripRect = rect(strip);
    return {
      activeLabel: active.textContent?.trim().replace(/\s+/g, " ") ?? "",
      activeRect: rect(active),
      activeSection: active.dataset.accountSection ?? "",
      stripRect,
      stripScrollLeft: strip.scrollLeft,
      stripScrollWidth: strip.scrollWidth,
    };
  });

const waitForMobileActiveVisible = async (
  page: Page,
  expectedSection: string
) => {
  await page.waitForFunction(
    (section) => {
      const strip = document.querySelector<HTMLElement>(
        "[data-account-mobile-navigation]"
      );
      const active = strip?.querySelector<HTMLButtonElement>(
        `button[data-account-section="${section}"][aria-current='page']`
      );
      if (!strip || !active) return false;
      const stripRect = strip.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      return (
        activeRect.width > 0 &&
        activeRect.height > 0 &&
        activeRect.left >= stripRect.left - 1 &&
        activeRect.right <= stripRect.right + 1
      );
    },
    expectedSection,
    { timeout: 5_000 }
  );
};

const assertZeroBoxChrome = (style: ComputedBoxStyle, label: string): void => {
  assertCondition(
    style.padding === "0px",
    `${label}: computed padding is ${style.padding}, not 0px`
  );
  for (const [edge, width] of [
    ["top", style.borderTopWidth],
    ["right", style.borderRightWidth],
    ["bottom", style.borderBottomWidth],
    ["left", style.borderLeftWidth],
  ] as const) {
    assertCondition(
      width === "0px",
      `${label}: computed ${edge} border is ${width}, not 0px`
    );
  }
  assertCondition(
    style.borderRadius === "0px",
    `${label}: computed border radius is ${style.borderRadius}, not 0px`
  );
};

const calculateExpectedStickyTop = (geometry: Geometry, offset: number) =>
  Math.min(
    geometry.header.bottom + offset,
    geometry.parent.bottom - geometry.aside.height
  );

const assertStickyClamp = (
  geometry: Geometry,
  label: string,
  offset: number
) => {
  const expectedTop = calculateExpectedStickyTop(geometry, offset);
  assertWithin(
    geometry.aside.y,
    expectedTop,
    `${label}: sticky aside top does not match containing-block clamp`
  );
  const contentWithinViewport =
    geometry.content.bottom > geometry.header.bottom + 1 &&
    geometry.content.y < geometry.viewport.height - 1;
  if (contentWithinViewport && expectedTop >= geometry.header.bottom - 1) {
    assertCondition(
      geometry.aside.y >= geometry.header.bottom - 1,
      `${label}: sticky aside overlaps the fixed site header while content is visible`
    );
  }
};

const assertNoHorizontalOverflow = (geometry: Geometry, label: string) => {
  assertCondition(
    geometry.scroll.documentWidth <= geometry.viewport.width + 1,
    `${label}: document horizontal overflow (${geometry.scroll.documentWidth} > ${geometry.viewport.width})`
  );
  assertCondition(
    geometry.scroll.bodyWidth <= geometry.viewport.width + 1,
    `${label}: body horizontal overflow (${geometry.scroll.bodyWidth} > ${geometry.viewport.width})`
  );
};

const assertDesktopStickyGeometry = (
  geometry: Geometry,
  scenario: Scenario,
  position: ScrollPosition
) => {
  const label = `${scenario.locale}/${scenario.width}x${scenario.height}/${scenario.content}/${scenario.sidebar}/${position}`;
  assertCondition(
    geometry.asideStyle.position === "sticky",
    `${label}: aside position is ${geometry.asideStyle.position}, not sticky`
  );
  const minimumTop = geometry.header.bottom + stickyGapPx;
  const desktopTop = Number.parseFloat(geometry.asideStyle.top);
  assertWithin(
    desktopTop,
    minimumTop,
    `${label}: desktop aside top does not preserve the header gap`
  );
  assertCondition(
    geometry.asideStyle.overflowY === "auto",
    `${label}: desktop aside overflow-y is ${geometry.asideStyle.overflowY}, not auto`
  );
  assertCondition(
    geometry.asideStyle.maxHeight !== "none",
    `${label}: desktop aside max-height is unconstrained`
  );
  assertCondition(
    geometry.navigationStyle.padding === "16px" &&
      geometry.navigationStyle.borderTopWidth === "1px" &&
      geometry.navigationStyle.borderRightWidth === "1px" &&
      geometry.navigationStyle.borderBottomWidth === "1px" &&
      geometry.navigationStyle.borderLeftWidth === "1px" &&
      geometry.navigationStyle.borderRadius === "20px",
    `${label}: desktop navigation chrome changed: ${JSON.stringify(geometry.navigationStyle)}`
  );
  const parentCannotFitAtStickyTop =
    minimumTop + geometry.aside.height > geometry.parent.bottom + 1;
  if (position !== "top" && !parentCannotFitAtStickyTop) {
    assertCondition(
      geometry.aside.y >= minimumTop - 1,
      `${label}: aside top ${geometry.aside.y} is above header gap ${minimumTop}`
    );
  }
  if (position !== "top" && scenario.content === "tall") {
    assertStickyClamp(geometry, label, stickyGapPx);
  }
  if (scenario.content === "tall" && position !== "top") {
    assertCondition(
      geometry.aside.bottom <= geometry.viewport.height - stickyGapPx + 1,
      `${label}: sticky aside bottom ${geometry.aside.bottom} exceeds viewport gap ${geometry.viewport.height - stickyGapPx}`
    );
  }
  assertNoHorizontalOverflow(geometry, label);
};

const readFocusedStepEvidence = async (
  page: Page
): Promise<FocusStepEvidence | null> =>
  page.evaluate(() => {
    const element = document.activeElement;
    const aside = document.querySelector<HTMLElement>("aside");
    const header = document.querySelector<HTMLElement>(
      "[data-account-sticky-site-header]"
    );
    if (!(element instanceof HTMLElement) || !aside || !header) return null;
    const rect = (value: DOMRect): Rect => ({
      bottom: value.bottom,
      height: value.height,
      right: value.right,
      width: value.width,
      x: value.x,
      y: value.y,
    });
    return {
      asideRect: rect(aside.getBoundingClientRect()),
      asideScrollTop: aside.scrollTop,
      headerBottom: header.getBoundingClientRect().bottom,
      isNavOrFooterControl: element.matches(
        "aside nav button, aside [data-account-sticky-sidebar-footer] button"
      ),
      pageScrollY: window.scrollY,
      rect: rect(element.getBoundingClientRect()),
      target: {
        id: element.id,
        label: element.textContent?.trim().replace(/\s+/g, " ") ?? "",
        tag: element.tagName.toLowerCase(),
      },
      viewportHeight: window.innerHeight,
    };
  });

const assertFocusedStepVisible = (
  step: FocusStepEvidence,
  scenario: Scenario,
  traversal: FocusTraversalPosition
) => {
  const label = `${scenario.width}x${scenario.height}/${scenario.content}/${scenario.sidebar}/${traversal}`;
  assertCondition(
    step.isNavOrFooterControl,
    `${label}: focus left the account navigation/footer controls: ${JSON.stringify(step.target)}`
  );
  const minimumTop = Math.max(step.asideRect.y, step.headerBottom);
  const maximumBottom = Math.min(step.asideRect.bottom, step.viewportHeight);
  assertCondition(
    step.rect.y >= minimumTop - 1,
    `${label}: focused ${step.target.label} top ${step.rect.y} is above focus intersection ${minimumTop}; aside=${JSON.stringify(step.asideRect)} headerBottom=${step.headerBottom} pageScrollY=${step.pageScrollY} asideScrollTop=${step.asideScrollTop}`
  );
  assertCondition(
    step.rect.bottom <= maximumBottom + 1,
    `${label}: focused ${step.target.label} bottom ${step.rect.bottom} exceeds focus intersection ${maximumBottom}; aside=${JSON.stringify(step.asideRect)} headerBottom=${step.headerBottom} pageScrollY=${step.pageScrollY} asideScrollTop=${step.asideScrollTop}`
  );
};

const traverseDesktopFocus = async (
  page: Page,
  scenario: Scenario,
  traversal: (typeof focusTraversalPlans)[number]
): Promise<FocusTraversalEvidence> => {
  const failures: string[] = [];
  await scrollPage(page, traversal.scrollPosition);
  await scrollAsideTo(page, "top");
  const start = await readGeometry(page);
  const asideScrollTopBefore = start.asideStyle.scrollTop;
  const steps: FocusStepEvidence[] = [];
  const visibleNavButtons = page.locator("aside nav button:visible");
  const expectedLabels = (await visibleNavButtons.allTextContents()).map(
    (label) => label.trim().replace(/\s+/g, " ")
  );
  const navButtonCount = await visibleNavButtons.count();
  if (navButtonCount !== 5) {
    failures.push(
      `${scenario.width}x${scenario.height}/${scenario.content}/${scenario.sidebar}/${traversal.label}: expected five account nav buttons, got ${navButtonCount}`
    );
  }
  try {
    await visibleNavButtons.first().evaluate((element) => {
      if (!(element instanceof HTMLButtonElement))
        throw new Error("first account nav button is not a button");
      element.focus({ preventScroll: true });
    });
    for (let index = 0; index < 16; index += 1) {
      const step = await readFocusedStepEvidence(page);
      if (!step) {
        failures.push(
          `${scenario.width}x${scenario.height}/${scenario.content}/${scenario.sidebar}/${traversal.label}: active element is not focusable`
        );
        break;
      }
      steps.push(step);
      try {
        assertFocusedStepVisible(step, scenario, traversal.label);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
      if (step.target.id === "account-sticky-sidebar-final") break;
      await page.keyboard.press("Tab");
    }
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
  const sequence = steps.map((step) => step.target);
  const finalStep = steps.at(-1);
  if (finalStep?.target.id !== "account-sticky-sidebar-final") {
    failures.push(
      `${scenario.width}x${scenario.height}/${scenario.content}/${scenario.sidebar}/${traversal.label}: keyboard focus did not reach final sidebar footer button; sequence=${JSON.stringify(sequence)}`
    );
  }
  for (const label of expectedLabels) {
    if (!sequence.some((target) => target.label === label)) {
      failures.push(
        `${scenario.width}x${scenario.height}/${scenario.content}/${scenario.sidebar}/${traversal.label}: navigation label was not keyboard reachable: ${label}`
      );
    }
  }
  if (!sequence.some((target) => target.id === "account-sticky-sidebar-help")) {
    failures.push(
      `${scenario.width}x${scenario.height}/${scenario.content}/${scenario.sidebar}/${traversal.label}: sidebar help button was not keyboard reachable`
    );
  }
  const after = await readGeometry(page);
  const asideMaxScrollTop = Math.max(
    0,
    after.asideStyle.scrollHeight - after.asideStyle.clientHeight
  );
  if (scenario.sidebar === "tall") {
    if (asideMaxScrollTop <= 1) {
      failures.push(
        `${scenario.width}x${scenario.height}/${scenario.content}/${scenario.sidebar}/${traversal.label}: tall sidebar did not create internal scroll space`
      );
    }
    if (after.asideStyle.scrollTop <= asideScrollTopBefore + 1) {
      failures.push(
        `${scenario.width}x${scenario.height}/${scenario.content}/${scenario.sidebar}/${traversal.label}: tabbing to final sidebar footer button did not scroll aside`
      );
    }
  }
  return {
    asideMaxScrollTop,
    asideRect: finalStep?.asideRect ?? after.aside,
    asideScrollTopAfter: after.asideStyle.scrollTop,
    asideScrollTopBefore,
    failures,
    final: finalStep?.target ?? null,
    finalRect: finalStep?.rect ?? null,
    label: traversal.label,
    sequence,
    start,
    steps,
  };
};

const checkDesktopFocus = async (
  page: Page,
  scenario: Scenario
): Promise<FocusCheckResult> => {
  const traversals: FocusTraversalEvidence[] = [];
  const failures: string[] = [];
  for (const traversal of focusTraversalPlans) {
    const evidence = await traverseDesktopFocus(page, scenario, traversal);
    traversals.push(evidence);
    failures.push(...evidence.failures);
  }
  return { evidence: { traversals }, failures };
};

const scrollTargetIntoView = async (
  page: Page,
  selector: string,
  block: "center" | "end"
) => {
  await page.evaluate(
    ({ selector: targetSelector, block: targetBlock }) => {
      const element = document.querySelector<HTMLElement>(targetSelector);
      if (!element) throw new Error(`Missing scroll target: ${targetSelector}`);
      element.scrollIntoView({ block: targetBlock, behavior: "auto" });
    },
    { block, selector }
  );
  await page.waitForFunction((targetSelector) => {
    const element = document.querySelector<HTMLElement>(targetSelector);
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return rect.top >= -1 && rect.bottom <= window.innerHeight + 1;
  }, selector);
};

const checkPageFooter = async (page: Page, label: string) => {
  const before = await readGeometry(page);
  assertCondition(
    before.scroll.maxY > 1,
    `${label}: document is not scrollable`
  );
  await scrollTargetIntoView(page, "[data-account-sticky-page-footer]", "end");
  const after = await readGeometry(page);
  assertCondition(
    after.scroll.y >= before.scroll.y - 1,
    `${label}: document scroll moved backward while reaching page footer`
  );
  assertCondition(
    after.scroll.y >= after.scroll.maxY - 1,
    `${label}: page footer was not reached at document scroll end`
  );
  assertCondition(
    after.pageFooter.y >= -1 &&
      after.pageFooter.bottom <= after.viewport.height + 1,
    `${label}: page footer is not visible after document scroll`
  );
  assertNoHorizontalOverflow(after, `${label}/page-footer`);
  return after.scroll.y;
};

const assertMobileGeometry = (geometry: Geometry, label: string) => {
  assertCondition(
    geometry.asideStyle.position === "sticky",
    `${label}: mobile aside is ${geometry.asideStyle.position}, not sticky`
  );
  const stickyTop = Number.parseFloat(geometry.asideStyle.top);
  assertCondition(
    Number.isFinite(stickyTop),
    `${label}: mobile aside top is not a finite pixel value (${geometry.asideStyle.top})`
  );
  assertWithin(
    stickyTop,
    geometry.header.bottom,
    `${label}: mobile aside top does not align below the site header`
  );
  assertCondition(
    geometry.asideStyle.overflowY !== "auto" &&
      geometry.asideStyle.overflowY !== "scroll",
    `${label}: mobile aside has a constrained vertical scroller (${geometry.asideStyle.overflowY})`
  );
  assertCondition(
    geometry.asideStyle.maxHeight === "none",
    `${label}: mobile aside max-height is constrained (${geometry.asideStyle.maxHeight})`
  );
  assertWithin(
    geometry.asideStyle.scrollHeight,
    geometry.asideStyle.clientHeight,
    `${label}: mobile aside has internal vertical overflow`
  );
  assertWithin(
    geometry.asideStyle.scrollTop,
    0,
    `${label}: mobile aside unexpectedly scrolled internally`
  );
  assertWithin(
    geometry.navigation.x,
    0,
    `${label}: mobile navigation card is not edge-to-edge at x=0`
  );
  assertWithin(
    geometry.navigation.width,
    geometry.viewport.width,
    `${label}: mobile navigation card is not viewport width`
  );
  assertWithin(
    geometry.mobileNavigation.x,
    0,
    `${label}: mobile navigation strip is not edge-to-edge at x=0`
  );
  assertWithin(
    geometry.mobileNavigation.width,
    geometry.viewport.width,
    `${label}: mobile navigation strip is not viewport width`
  );
  assertZeroBoxChrome(geometry.navigationStyle, `${label}/navigation card`);
  assertZeroBoxChrome(geometry.mobileFieldsetStyle, `${label}/mobile fieldset`);
  assertZeroBoxChrome(
    geometry.mobileNavigationStyle,
    `${label}/mobile navigation strip`
  );
  assertCondition(
    geometry.mobileNavigationStyle.overflowX === "auto" ||
      geometry.mobileNavigationStyle.overflowX === "scroll",
    `${label}: mobile navigation strip overflow-x is ${geometry.mobileNavigationStyle.overflowX}`
  );
  assertCondition(
    geometry.mobileNavigationStyle.scrollSnapType.includes("x"),
    `${label}: mobile navigation strip has no horizontal snap (${geometry.mobileNavigationStyle.scrollSnapType})`
  );
  assertCondition(
    geometry.mobileLegend.className.split(/\s+/).includes("sr-only"),
    `${label}: mobile navigation legend is not visually hidden with sr-only`
  );
  assertCondition(
    geometry.mobileLegend.style.display !== "none" &&
      geometry.mobileLegend.style.visibility !== "hidden",
    `${label}: mobile navigation legend is removed from the accessibility tree`
  );
  assertCondition(
    geometry.mobileLegend.text.length > 0 &&
      geometry.mobileLegend.accessibleNameReference ===
        geometry.mobileLegend.id,
    `${label}: mobile navigation legend accessible name reference is missing`
  );
  assertCondition(
    geometry.sidebarFooter !== null,
    `${label}: mobile sidebar help/footer is missing`
  );
  if (geometry.sidebarFooter !== null) {
    assertCondition(
      geometry.sidebarFooter.y >= geometry.content.bottom - 1,
      `${label}: mobile sidebar help/footer is not below all account content`
    );
    assertCondition(
      geometry.pageFooter.y >= geometry.sidebarFooter.bottom - 1,
      `${label}: page footer is not below the mobile sidebar help/footer`
    );
  }
  assertNoHorizontalOverflow(geometry, label);
};

const assertMobileNavigationState = (
  state: MobileNavigationState,
  expectedSection: string,
  label: string
) => {
  assertCondition(
    state.activeSection === expectedSection,
    `${label}: active mobile section is ${state.activeSection}, not ${expectedSection}`
  );
  assertCondition(
    state.activeRect.width > 0 && state.activeRect.height > 0,
    `${label}: active mobile section button has no layout box`
  );
  assertCondition(
    state.activeRect.x >= state.stripRect.x - 1,
    `${label}: active mobile section button starts outside the navigation strip (${state.activeRect.x} < ${state.stripRect.x})`
  );
  assertCondition(
    state.activeRect.right <= state.stripRect.right + 1,
    `${label}: active mobile section button ends outside the navigation strip (${state.activeRect.right} > ${state.stripRect.right})`
  );
};

const checkMobileNavigation = async (
  page: Page,
  label: string
): Promise<MobileNavigationEvidence> => {
  const failures: string[] = [];
  const legend = page.locator("fieldset legend").first();
  const legendText = ((await legend.textContent()) ?? "").trim();
  let accessibleGroupCount = 0;
  try {
    const group = page.getByRole("group", { exact: true, name: legendText });
    await group.waitFor({ state: "attached" });
    accessibleGroupCount = await group.count();
    assertCondition(
      legendText.length > 0 && accessibleGroupCount === 1,
      `${label}: mobile navigation accessible group count is ${accessibleGroupCount} for ${JSON.stringify(legendText)}`
    );
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }

  let initial: MobileNavigationState;
  try {
    await waitForMobileActiveVisible(page, "profile");
    initial = await readMobileNavigation(page);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    initial = await readMobileNavigation(page);
  }
  try {
    assertMobileNavigationState(initial, "profile", `${label}/initial`);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }

  const dangerButton = page.locator(
    "aside nav button[data-account-section='danger']:visible"
  );
  let afterSectionChange = initial;
  try {
    await dangerButton.click();
    await page.waitForFunction(
      () =>
        document.querySelector(
          "[data-account-mobile-navigation] button[data-account-section='danger'][aria-current='page']"
        ) !== null
    );
    await waitForMobileActiveVisible(page, "danger");
    afterSectionChange = await readMobileNavigation(page);
    assertMobileNavigationState(
      afterSectionChange,
      "danger",
      `${label}/after-section-change`
    );
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }

  return {
    accessibleGroupCount,
    afterSectionChange,
    failures,
    initial,
    legendText,
  };
};

const runDesktopScenario = async (
  browser: Browser,
  scenario: Scenario,
  screenshotDirectory: string
): Promise<DesktopScenarioEvidence> => {
  const problems: string[] = [];
  const failures: string[] = [];
  const positions: DesktopPositionEvidence[] = [];
  let focus: FocusEvidence | null = null;
  let sidebarEndScreenshot: string | null = null;
  let pageFooterScrollY: number | null = null;
  let context: BrowserContext | undefined;
  try {
    context = await createContext(browser, scenario, problems);
    const page = await context.newPage();
    await loadFixture(page, scenario, problems);
    const scrollEvidence: Geometry[] = [];
    for (const position of scrollPositions) {
      const geometry = await scrollPage(page, position);
      scrollEvidence.push(geometry);
      const expectedStickyTop = calculateExpectedStickyTop(
        geometry,
        stickyGapPx
      );
      const expectedParentConstrainedBottom = Math.min(
        geometry.viewport.height - stickyGapPx,
        geometry.parent.bottom
      );
      let positionFailure: string | null = null;
      try {
        assertDesktopStickyGeometry(geometry, scenario, position);
      } catch (error) {
        positionFailure =
          error instanceof Error ? error.message : String(error);
      }
      if (position === "bottom") {
        try {
          assertCondition(
            geometry.aside.bottom <= expectedParentConstrainedBottom + 1,
            `${scenario.width}x${scenario.height}/${scenario.content}/${scenario.sidebar}: aside bottom ${geometry.aside.bottom} exceeds min viewport/parent end ${expectedParentConstrainedBottom}`
          );
        } catch (error) {
          positionFailure ??=
            error instanceof Error ? error.message : String(error);
        }
      }
      const screenshot = join(
        screenshotDirectory,
        `desktop-${scenario.width}x${scenario.height}-${scenario.content}-${scenario.sidebar}-${position}.png`
      );
      try {
        await page.screenshot({ path: screenshot });
      } catch (error) {
        positionFailure ??=
          error instanceof Error ? error.message : String(error);
      }
      positions.push({
        expectedStickyTop,
        expectedParentConstrainedBottom,
        geometry,
        position,
        screenshot: relative(artifactRoot, screenshot),
      });
      if (positionFailure !== null) {
        failures.push(positionFailure);
      }
    }
    if (scenario.content === "tall") {
      const top = scrollEvidence[0];
      const middle = scrollEvidence[1];
      const bottom = scrollEvidence[2];
      assertCondition(
        middle !== undefined &&
          top !== undefined &&
          middle.scroll.y > top.scroll.y + 1,
        `${scenario.width}x${scenario.height}/${scenario.content}/${scenario.sidebar}: middle document scroll position did not change`
      );
      assertCondition(
        bottom !== undefined &&
          middle !== undefined &&
          bottom.scroll.y > middle.scroll.y + 1,
        `${scenario.width}x${scenario.height}/${scenario.content}/${scenario.sidebar}: bottom document scroll position did not change`
      );
    }
    try {
      const focusResult = await checkDesktopFocus(page, scenario);
      focus = focusResult.evidence;
      failures.push(...focusResult.failures);
      if (scenario.sidebar === "tall") {
        await scrollAsideTo(page, "bottom");
        const screenshot = join(
          screenshotDirectory,
          `desktop-${scenario.width}x${scenario.height}-${scenario.content}-${scenario.sidebar}-sidebar-end.png`
        );
        await page.screenshot({ path: screenshot });
        sidebarEndScreenshot = relative(artifactRoot, screenshot);
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
    try {
      pageFooterScrollY = await checkPageFooter(
        page,
        `${scenario.width}x${scenario.height}/${scenario.content}/${scenario.sidebar}`
      );
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
    failures.push(...problems);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  } finally {
    await context?.close();
  }
  return {
    failures,
    focus,
    pageFooterScrollY,
    positions,
    scenario,
    sidebarEndScreenshot,
    status: failures.length === 0 ? "passed" : "failed",
  };
};

const runMobileScenario = async (
  browser: Browser,
  scenario: Scenario,
  screenshotDirectory: string
): Promise<MobileScenarioEvidence> => {
  const problems: string[] = [];
  const failures: string[] = [];
  let initial: Geometry | null = null;
  let navigation: MobileNavigationEvidence | null = null;
  const positions: MobilePositionEvidence[] = [];
  let sectionChangeScreenshot: string | null = null;
  let sidebarFooterScrollY: number | null = null;
  let pageFooterScrollY: number | null = null;
  let screenshot: string | null = null;
  let context: BrowserContext | undefined;
  try {
    context = await createContext(browser, scenario, problems);
    const page = await context.newPage();
    await loadFixture(page, scenario, problems);
    const label = `${scenario.locale}/${scenario.width}x${scenario.height}/${scenario.content}/${scenario.sidebar}`;
    for (const position of scrollPositions) {
      const geometry = await scrollPage(page, position);
      if (position === "top") initial = geometry;
      let positionFailure: string | null = null;
      try {
        assertMobileGeometry(geometry, `${label}/${position}`);
        if (
          position !== "top" &&
          (position === "bottom" || scenario.content === "tall")
        ) {
          assertStickyClamp(geometry, `${label}/${position}`, 0);
        }
      } catch (error) {
        positionFailure =
          error instanceof Error ? error.message : String(error);
      }
      if (position === "top") {
        try {
          await waitForMobileActiveVisible(page, "profile");
        } catch (error) {
          positionFailure ??=
            error instanceof Error ? error.message : String(error);
        }
      }
      const positionScreenshot = join(
        screenshotDirectory,
        `mobile-${scenario.locale}-${scenario.width}x${scenario.height}-${scenario.content}-${scenario.sidebar}-${position}.png`
      );
      try {
        await page.screenshot({ path: positionScreenshot });
      } catch (error) {
        positionFailure ??=
          error instanceof Error ? error.message : String(error);
      }
      positions.push({
        expectedStickyTop: calculateExpectedStickyTop(geometry, 0),
        geometry,
        position,
        screenshot: relative(artifactRoot, positionScreenshot),
      });
      if (positionFailure !== null) failures.push(positionFailure);

      if (position === "top") {
        try {
          navigation = await checkMobileNavigation(page, label);
          failures.push(...navigation.failures);
          const afterSectionChange = await readGeometry(page);
          assertMobileGeometry(
            afterSectionChange,
            `${label}/after-section-change`
          );
          sectionChangeScreenshot = join(
            screenshotDirectory,
            `mobile-${scenario.locale}-${scenario.width}x${scenario.height}-${scenario.content}-${scenario.sidebar}-section-change.png`
          );
          await page.screenshot({ path: sectionChangeScreenshot });
        } catch (error) {
          failures.push(error instanceof Error ? error.message : String(error));
        }
      }
    }
    const top = positions.find((position) => position.position === "top");
    const middle = positions.find((position) => position.position === "middle");
    const bottom = positions.find((position) => position.position === "bottom");
    assertCondition(
      top !== undefined &&
        middle !== undefined &&
        middle.geometry.scroll.y > top.geometry.scroll.y + 1,
      `${label}: middle document scroll position did not change`
    );
    assertCondition(
      middle !== undefined &&
        bottom !== undefined &&
        bottom.geometry.scroll.y > middle.geometry.scroll.y + 1,
      `${label}: bottom document scroll position did not change`
    );
    screenshot =
      positions.find((position) => position.position === "top")?.screenshot ??
      null;
    if (initial === null)
      throw new Error(`${label}: mobile top geometry is missing`);
    await scrollTargetIntoView(page, "#account-sticky-sidebar-final", "center");
    const sidebarFooter = await readGeometry(page);
    sidebarFooterScrollY = sidebarFooter.scroll.y;
    assertCondition(
      sidebarFooter.scroll.y >= initial.scroll.y,
      `${label}: document could not reach sidebar footer`
    );
    assertNoHorizontalOverflow(sidebarFooter, `${label}/sidebar-footer`);
    pageFooterScrollY = await checkPageFooter(page, label);
    assertCondition(
      pageFooterScrollY > initial.scroll.y + 1,
      `${label}: page footer did not require document scrolling`
    );
    const afterFooter = await readGeometry(page);
    assertMobileGeometry(afterFooter, `${label}/page-footer`);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  } finally {
    failures.push(...problems);
    await context?.close();
  }
  return {
    failures,
    initial,
    navigation,
    pageFooterScrollY,
    positions,
    scenario,
    sectionChangeScreenshot:
      sectionChangeScreenshot === null
        ? null
        : relative(artifactRoot, sectionChangeScreenshot),
    screenshot,
    sidebarFooterScrollY,
    status: failures.length === 0 ? "passed" : "failed",
  };
};

const runRegressionProbe = async (
  browser: Browser
): Promise<{
  readonly status: "passed" | "failed";
  readonly observedFailure: string | null;
}> => {
  const problems: string[] = [];
  const scenarios: readonly Scenario[] = [
    {
      content: "tall",
      height: 900,
      locale: "en-US",
      sidebar: "normal",
      width: 1440,
    },
    {
      content: "tall",
      height: 900,
      locale: "en-US",
      sidebar: "normal",
      width: 375,
    },
  ];
  for (const scenario of scenarios) {
    let context: BrowserContext | undefined;
    try {
      context = await createContext(browser, scenario, problems);
      const page = await context.newPage();
      await loadFixture(page, scenario, problems, "static");
      const geometry = await scrollPage(page, "middle");
      try {
        if (scenario.width >= 768) {
          assertDesktopStickyGeometry(geometry, scenario, "middle");
        } else {
          assertMobileGeometry(
            geometry,
            `${scenario.locale}/${scenario.width}`
          );
        }
      } catch (error) {
        return {
          observedFailure: `${scenario.locale}/${scenario.width}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          status: "passed",
        };
      }
    } finally {
      await context?.close();
    }
  }
  return { observedFailure: null, status: "failed" };
};

const makeScenario = (
  locale: FixtureLocale,
  width: number,
  height: number,
  content: ContentVariant,
  sidebar: SidebarVariant
): Scenario => ({ content, height, locale, sidebar, width });

const main = async () => {
  await rm(artifactRoot, { force: true, recursive: true });
  await mkdir(artifactRoot, { recursive: true });
  await writeNonstickyOverride();
  const productionBuild = await buildBundle(
    "production",
    productionBuildRoot,
    accountShellPath
  );
  const nonstickyBuild = await buildBundle(
    "nonsticky",
    regressionBuildRoot,
    accountShellPath
  );
  const sourceHashes: SourceHashes = {
    accountShell: await describeFile(accountShellPath),
    accountFrame: await describeFile(accountFramePath),
    fixtureEntry: await describeFile(browserEntryPath),
    globalsCss: await describeFile(globalsCssPath),
    nonstickyOverride: await describeFile(regressionAccountFramePath),
    postCssConfig: await describeFile(postCssConfigPath),
    runner: await describeFile(join(import.meta.dir, "run.ts")),
  };

  const screenshotDirectory = join(artifactRoot, "screenshots");
  await mkdir(screenshotDirectory, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const desktop: DesktopScenarioEvidence[] = [];
  const mobile: MobileScenarioEvidence[] = [];
  let server: Awaited<ReturnType<typeof serveBuild>> | undefined;
  let regression: GeometryReport["regression"] = {
    observedFailure: null as string | null,
    status: "failed" as const,
  };
  const failures: string[] = [];
  try {
    server = await serveBuild(productionBuild);
    for (const width of desktopWidths) {
      for (const content of contentVariants) {
        for (const sidebar of sidebarVariants) {
          const evidence = await runDesktopScenario(
            browser,
            makeScenario(
              "en-US",
              width,
              width === 1440 ? 900 : 600,
              content,
              sidebar
            ),
            screenshotDirectory
          );
          desktop.push(evidence);
          failures.push(
            ...evidence.failures.map(
              (failure) =>
                `desktop ${JSON.stringify(evidence.scenario)}: ${failure}`
            )
          );
        }
      }
    }
    for (const locale of mobileLocales) {
      for (const width of mobileWidths) {
        for (const content of contentVariants) {
          for (const sidebar of sidebarVariants) {
            const evidence = await runMobileScenario(
              browser,
              makeScenario(locale, width, 900, content, sidebar),
              screenshotDirectory
            );
            mobile.push(evidence);
            failures.push(
              ...evidence.failures.map(
                (failure) =>
                  `mobile ${JSON.stringify(evidence.scenario)}: ${failure}`
              )
            );
          }
        }
      }
    }
    await server.server.stop(true);
    server = undefined;
    server = await serveBuild(nonstickyBuild);
    regression = await runRegressionProbe(browser);
    if (regression.status === "failed") {
      failures.push(
        "isolated nonsticky regression probe did not fail the sticky geometry assertion"
      );
    }
  } finally {
    await server?.server.stop(true);
    await browser.close();
  }

  const report: GeometryReport = {
    browser: {
      bunVersion: Bun.version,
      engine: "Chromium",
      version: browser.version(),
    },
    builds: { nonsticky: nonstickyBuild, production: productionBuild },
    desktop,
    failures,
    matrix: {
      desktopLocales: ["en-US"],
      desktopPositions: desktop.reduce(
        (count, scenario) => count + scenario.positions.length,
        0
      ),
      desktopScenarios: desktop.length,
      mobileLocales,
      mobilePositions: mobile.reduce(
        (count, scenario) => count + scenario.positions.length,
        0
      ),
      mobileScenarios: mobile.length,
      mobileSectionChangeScreenshots: mobile.filter(
        (scenario) => scenario.sectionChangeScreenshot !== null
      ).length,
      mobileWidths,
    },
    mobile,
    regression,
    schemaVersion: 3,
    scope: {
      browserServer: "localhost:3163",
      kind: "isolated-production-component-fixture",
      realSiteHeaderHeight: "6rem",
      routeE2E: false,
      syntheticPageFooter: true,
      syntheticSiteHeader: true,
    },
    sourceHashes,
  };
  const reportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(artifactRoot, "geometry.json"), reportBytes);
  await writeFile(
    join(artifactRoot, "source-hashes.json"),
    `${JSON.stringify(sourceHashes, null, 2)}\n`
  );
  process.stdout.write(
    `${JSON.stringify({
      artifactRoot: displayPath(artifactRoot),
      desktopPositions: desktop.reduce(
        (count, scenario) => count + scenario.positions.length,
        0
      ),
      desktopScenarios: desktop.length,
      failures: failures.length,
      geometry: displayPath(join(artifactRoot, "geometry.json")),
      mobileLocales,
      mobilePositions: mobile.reduce(
        (count, scenario) => count + scenario.positions.length,
        0
      ),
      mobileScenarios: mobile.length,
      mobileSectionChangeScreenshots: mobile.filter(
        (scenario) => scenario.sectionChangeScreenshot !== null
      ).length,
      mobileWidths,
      regression: regression.status,
      sourceHashes: displayPath(join(artifactRoot, "source-hashes.json")),
    })}\n`
  );
  if (failures.length > 0) {
    throw new Error(
      `Account sticky geometry checks failed (${failures.length}); see ${displayPath(join(artifactRoot, "geometry.json"))}`
    );
  }
};

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
    );
    process.exitCode = 1;
  });
}
