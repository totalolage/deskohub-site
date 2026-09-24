import { expect } from "bun:test";
import {
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import {
  basename,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import {
  clearTimeout as clearNativeTimeout,
  setTimeout as setNativeTimeout,
} from "node:timers";
import {
  type Browser,
  type BrowserContext,
  chromium,
  type Page,
} from "@playwright/test";
import { Predicate, Schema } from "effect";
import { m } from "../../features/i18n";
import {
  resolveModulePath,
  transformGlobalsCss,
} from "../shared/app-module-build";

type BuildOutput = { readonly path: string };
type BuildMessagePosition = {
  readonly column?: number;
  readonly file?: string;
  readonly line?: number;
};
type BuildMessage = {
  readonly message: string;
  readonly position?: BuildMessagePosition;
};
type BuildResult = {
  readonly logs?: readonly BuildMessage[];
  readonly outputs: readonly BuildOutput[];
  readonly success: boolean;
};

type MarketingPreferencesFixtureOptions = {
  readonly appRoot: string;
  readonly outputDirectory: string;
  readonly terminationGraceMs?: number;
};

type SchedulerEvidence = {
  readonly path: string;
  readonly bytes: number;
};

type MarketingPreferencesFixture = {
  readonly cssPath: string;
  readonly entryPath: string;
  readonly javascriptPath: string;
  readonly scheduler: SchedulerEvidence;
};

const positiveSafeIntegerSchema = Schema.Int.check(
  Schema.isGreaterThan(0)
).check(Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER));
const fixtureSchedulerSchema = Schema.Struct({
  bytes: positiveSafeIntegerSchema,
  path: Schema.NonEmptyString,
});
const fixtureSuccessSchema = Schema.Struct({
  bunVersion: Schema.NonEmptyString,
  cssPath: Schema.NonEmptyString,
  entryPath: Schema.NonEmptyString,
  javascriptPath: Schema.NonEmptyString,
  scheduler: fixtureSchedulerSchema,
  status: Schema.Literal("ok"),
});
const fixtureErrorSchema = Schema.Struct({
  message: Schema.NonEmptyString,
  status: Schema.Literal("error"),
});
const browserSuccessSchema = Schema.Struct({
  bunVersion: Schema.NonEmptyString,
  logPath: Schema.NonEmptyString,
  reportPath: Schema.NonEmptyString,
  status: Schema.Literal("ok"),
});
type FixtureSuccessMessage = Schema.Schema.Type<typeof fixtureSuccessSchema>;
type FixtureErrorMessage = Schema.Schema.Type<typeof fixtureErrorSchema>;
type FixtureMessage = FixtureSuccessMessage | FixtureErrorMessage;
type BrowserSuccessMessage = Schema.Schema.Type<typeof browserSuccessSchema>;
type BrowserMessage = BrowserSuccessMessage | FixtureErrorMessage;
type JsonObject = Schema.JsonObject;
const jsonObjectSchema = Schema.Record(Schema.String, Schema.Json);

const diagnosticRedactedValue = "[REDACTED]";
const diagnosticUrlCredentialsPattern = /((?:https?:)?\/\/)[^/\s@]+@/gi;
const diagnosticQueryCredentialsPattern =
  /([?&][^=&#\s]*(?:access[-_]?token|api[-_]?key|apikey|auth(?:orization)?|code|credential(?:s)?|key|password|passwd|pwd|secret|session|signature|state|token)[^=&#\s]*=)[^&#\s]*/gi;
const diagnosticEnvironmentAssignmentPattern =
  /\b([A-Z][A-Z0-9_]{2,})=[^\r\n]*/g;

const sanitizeBuildDiagnosticString = (value: string): string =>
  value
    .replace(diagnosticUrlCredentialsPattern, `$1${diagnosticRedactedValue}@`)
    .replace(diagnosticQueryCredentialsPattern, `$1${diagnosticRedactedValue}`)
    .replace(
      diagnosticEnvironmentAssignmentPattern,
      `$1=${diagnosticRedactedValue}`
    );

const readBuildProperty = (cause: unknown, key: string): unknown => {
  if (!Predicate.isObject(cause)) return undefined;
  try {
    return Reflect.get(cause, key);
  } catch {
    return undefined;
  }
};

const readBuildMessage = (cause: unknown): BuildMessage | undefined => {
  if (!Predicate.isObject(cause)) return undefined;
  const message = readBuildProperty(cause, "message");
  if (!Predicate.isString(message)) return undefined;

  const rawPosition = readBuildProperty(cause, "position");
  if (!Predicate.isObject(rawPosition)) return { message };

  const file = readBuildProperty(rawPosition, "file");
  const line = readBuildProperty(rawPosition, "line");
  const column = readBuildProperty(rawPosition, "column");
  return {
    message,
    position: {
      column:
        Predicate.isNumber(column) && Number.isFinite(column)
          ? column
          : undefined,
      file: Predicate.isString(file) ? file : undefined,
      line:
        Predicate.isNumber(line) && Number.isFinite(line) ? line : undefined,
    },
  };
};

const formatBuildMessage = ({ message, position }: BuildMessage): string => {
  const file = position?.file
    ? sanitizeBuildDiagnosticString(position.file)
    : undefined;
  const line = position?.line === undefined ? undefined : String(position.line);
  const column =
    position?.column === undefined ? undefined : String(position.column);
  let location = "";
  if (file) {
    location = file;
    if (line !== undefined) {
      location += `:${line}`;
      if (column !== undefined) location += `:${column}`;
    }
  } else if (line !== undefined) {
    location = `line ${line}`;
    if (column !== undefined) location += `:${column}`;
  } else if (column !== undefined) {
    location = `column ${column}`;
  }

  const text = sanitizeBuildDiagnosticString(message);
  return location ? `${location}: ${text}` : text;
};

export const formatBuildDiagnostics = (cause: unknown): string => {
  const seen = new Set<object>();
  const format = (cause: unknown): string => {
    if (cause instanceof AggregateError) {
      if (seen.has(cause)) return "[circular build diagnostic]";
      seen.add(cause);
      const details = cause.errors.map(format).filter(Boolean).join("\n");
      return details || sanitizeBuildDiagnosticString(cause.message);
    }

    if (Array.isArray(cause)) {
      if (seen.has(cause)) return "[circular build diagnostic]";
      seen.add(cause);
      return cause.map(format).filter(Boolean).join("\n");
    }

    const buildMessage = readBuildMessage(cause);
    if (buildMessage) return formatBuildMessage(buildMessage);
    if (cause instanceof Error)
      return sanitizeBuildDiagnosticString(cause.message);

    if (
      cause === null ||
      Predicate.isString(cause) ||
      Predicate.isNumber(cause) ||
      Predicate.isBoolean(cause)
    ) {
      return sanitizeBuildDiagnosticString(String(cause));
    }

    return "[unknown build diagnostic]";
  };

  return format(cause);
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
    : (params.get(action + "Outcome") ?? params.get("outcome")) === "transport"
      ? "transport"
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
  if (outcomeFor(action) === "transport") {
    throw new Error("synthetic " + action + " transport failure");
  }
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

const controlledCookieConsentSource = `
import { useCallback, useState } from "react";

export type ConsentCategory =
  | "necessary"
  | "analytics"
  | "marketing"
  | "preferences";

const optionalCategories = ["analytics", "marketing", "preferences"];
const cookieSearchParam = (category: ConsentCategory) =>
  "cookie" + category[0].toUpperCase() + category.slice(1);

const readInitialAcceptedCategories = (): ConsentCategory[] => {
  if (globalThis.window === undefined) return ["necessary"];
  const params = new URLSearchParams(globalThis.location.search);
  const accepted: ConsentCategory[] = ["necessary"];
  for (const category of optionalCategories) {
    if (params.get(cookieSearchParam(category)) === "on") accepted.push(category);
  }
  return accepted;
};

const cookieActionDelayMs = () => {
  const value = Number.parseInt(
    new URLSearchParams(globalThis.location.search).get("cookieDelay") ?? "24",
    10
  );
  return Number.isFinite(value) && value >= 0 ? value : 24;
};

const cookieActionOutcome = () =>
  new URLSearchParams(globalThis.location.search).get("cookieOutcome") ===
  "error"
    ? "error"
    : "success";

const runCookieAction = async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, cookieActionDelayMs()));
  if (cookieActionOutcome() === "error") {
    throw new Error("synthetic cookie consent action failure");
  }
};

export function useCookieConsent() {
  const [acceptedCategories, setAcceptedCategories] =
    useState<ConsentCategory[]>(readInitialAcceptedCategories);

  const setCategoryAccepted = (category: ConsentCategory, accepted: boolean) => {
    setAcceptedCategories((current) =>
      current.includes(category) === accepted
        ? current
        : accepted
          ? [...current, category]
          : current.filter((item) => item !== category)
    );
  };

  const acceptCategory = async (category: ConsentCategory) => {
    if (category === "necessary") return;
    setCategoryAccepted(category, true);
    await runCookieAction();
  };

  const rejectCategory = async (category: ConsentCategory) => {
    if (category === "necessary") return;
    setCategoryAccepted(category, false);
    await runCookieAction();
  };

  const acceptAll = async () => {
    setAcceptedCategories(["necessary", ...optionalCategories]);
    await runCookieAction();
  };

  const rejectAll = async () => {
    setAcceptedCategories(["necessary"]);
    await runCookieAction();
  };

  const showPreferences = () => undefined;

  const isAccepted = (category: ConsentCategory) =>
    acceptedCategories.includes(category);

  return {
    acceptedCategories,
    acceptAll,
    rejectAll,
    showPreferences,
    acceptCategory,
    rejectCategory,
    isAccepted,
  };
}
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
  readonly onSuccess?: (args: {
    readonly data?: unknown;
    readonly input: unknown;
  }) => void;
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
        options.onSuccess?.({ data: nextResult.data, input });
      }
      return nextResult;
    } catch (error) {
      setIsExecuting(false);
      const logScope = globalThis as typeof globalThis & {
        readonly __marketingPreferencesActionLog?: {
          readonly events?: unknown[];
        };
      };
      logScope.__marketingPreferencesActionLog?.events?.push({
        action: "transport-error",
        input: {},
      });
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

const makeEntry = ({
  adapterPath,
  globalsCssPath,
}: {
  readonly adapterPath: string;
  readonly globalsCssPath: string;
}) => `
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

const makeBuildPlugin = ({
  appRequire,
  appRoot,
  globalsCssPath,
  nextNavigationStubPath,
}: {
  readonly appRequire: ReturnType<typeof createRequire>;
  readonly appRoot: string;
  readonly globalsCssPath: string;
  readonly nextNavigationStubPath: string;
}): Bun.BunPlugin => {
  const virtualNamespace = "marketing-preferences-controlled-renderer";
  const actionModulePath = "controlled-actions";
  const hookModulePath = "controlled-hook";
  const cookieHookModulePath = "controlled-cookie-consent";

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
      build.onResolve({ filter: /^@\/features\/cookie-consent$/ }, () => ({
        namespace: virtualNamespace,
        path: cookieHookModulePath,
      }));
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
      build.onLoad(
        { filter: /^controlled-cookie-consent$/, namespace: virtualNamespace },
        () => ({ contents: controlledCookieConsentSource, loader: "ts" })
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
        return await transformGlobalsCss(globalsCssPath, appRoot);
      });
    },
  };
};

const readSchedulerEvidence = async (
  appRequire: ReturnType<typeof createRequire>
): Promise<SchedulerEvidence> => {
  let schedulerPath: string;
  try {
    schedulerPath = appRequire.resolve("scheduler");
  } catch {
    throw new Error("Could not resolve scheduler source");
  }

  let schedulerStats: Awaited<ReturnType<typeof stat>>;
  try {
    schedulerStats = await stat(schedulerPath);
  } catch {
    throw new Error("Could not stat scheduler source");
  }
  if (!schedulerStats.isFile()) {
    throw new Error("Scheduler source is not a regular file");
  }

  let schedulerSource: Uint8Array;
  try {
    schedulerSource = await readFile(schedulerPath);
  } catch {
    throw new Error("Could not read scheduler source");
  }
  if (schedulerSource.byteLength === 0) {
    throw new Error("Scheduler source is empty");
  }

  return { bytes: schedulerSource.byteLength, path: schedulerPath };
};

export async function buildMarketingPreferencesFixture({
  appRoot,
  outputDirectory,
}: MarketingPreferencesFixtureOptions): Promise<MarketingPreferencesFixture> {
  const scriptDirectory = join(appRoot, "scripts/account-visual");
  const adapterPath = join(
    scriptDirectory,
    "marketing-preferences-adapter.tsx"
  );
  const globalsCssPath = join(appRoot, "app/globals.css");
  const nextNavigationStubPath = join(
    scriptDirectory,
    "stubs/next-navigation.ts"
  );
  const appRequire = createRequire(join(appRoot, "package.json"));
  const scheduler = await readSchedulerEvidence(appRequire);
  const buildDirectory = join(outputDirectory, "build");
  await mkdir(buildDirectory, { recursive: true });
  const entryPath = join(outputDirectory, "entry.tsx");
  await writeFile(
    entryPath,
    makeEntry({ adapterPath, globalsCssPath }),
    "utf8"
  );
  let result: BuildResult;
  try {
    result = (await Bun.build({
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      entrypoints: [entryPath],
      format: "esm",
      minify: false,
      outdir: buildDirectory,
      plugins: [
        makeBuildPlugin({
          appRequire,
          appRoot,
          globalsCssPath,
          nextNavigationStubPath,
        }),
      ],
      sourcemap: "none",
      target: "browser",
    })) as BuildResult;
  } catch (error) {
    const details = formatBuildDiagnostics(error);
    throw new Error(`Marketing preferences browser bundle threw: ${details}`);
  }
  if (!result.success) {
    const details = formatBuildDiagnostics(result.logs ?? []);
    throw new Error(
      ["Marketing preferences browser bundle failed", details]
        .filter(Boolean)
        .join("\n")
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
  return { cssPath, entryPath, javascriptPath, scheduler };
}

const browserRepoRoot = resolve(import.meta.dir, "../../../..");

const browserLocales = ["en-US", "cs-CZ"] as const;
type BrowserLocale = (typeof browserLocales)[number];

const browserViewports = [
  { height: 900, name: "320", width: 320 },
  { height: 900, name: "375", width: 375 },
  { height: 900, name: "480", width: 480 },
  { height: 900, name: "desktop", width: 1280 },
] as const;
type BrowserViewport = (typeof browserViewports)[number];

const browserScenarios = [
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
type BrowserScenario = (typeof browserScenarios)[number];

type BrowserRect = {
  readonly bottom: number;
  readonly height: number;
  readonly right: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
};

type BrowserInteractiveElement = {
  readonly disabled: boolean;
  readonly id: string;
  readonly label: string;
  readonly tag: string;
  readonly visible: boolean;
};

type BrowserGeometry = {
  readonly bodyScrollWidth: number;
  readonly documentScrollWidth: number;
  readonly interactive: readonly BrowserInteractiveElement[];
  readonly main: BrowserRect | null;
  readonly offenders: readonly {
    readonly id: string;
    readonly rect: BrowserRect;
    readonly tag: string;
  }[];
  readonly section: BrowserRect | null;
  readonly viewport: { readonly height: number; readonly width: number };
};

type BrowserFocusTarget = {
  readonly id: string;
  readonly label: string;
  readonly role: string | null;
  readonly tag: string;
};

type BrowserActionEvent = {
  readonly action: "clear" | "confirm" | "save" | "transport-error";
  readonly input: {
    readonly confirmed?: boolean;
    readonly context?: string;
    readonly granted?: boolean;
    readonly locale?: BrowserLocale;
    readonly source?: "account" | "link";
  };
};

type BrowserScreenshotEvidence = {
  readonly actions: readonly BrowserActionEvent[];
  readonly focusSequence: readonly BrowserFocusTarget[];
  readonly fullPage: true;
  readonly geometry: BrowserGeometry;
  readonly locale: BrowserLocale;
  readonly phase: string;
  readonly scenario: BrowserScenario;
  readonly screenshot: string;
  readonly viewport: string;
};

type BrowserProblems = {
  readonly consoleErrors: string[];
  readonly externalRequests: string[];
  readonly pageErrors: string[];
};

type BrowserFixturePaths = {
  readonly adapterPath: string;
  readonly artifactRoot: string;
  readonly italicFontPath: string;
  readonly productionCookieSettingsPath: string;
  readonly productionFormPath: string;
  readonly regularFontPath: string;
  readonly rendererCssPath: string;
  readonly repoRoot: string;
};

type BrowserFixtureRunContext = BrowserFixturePaths & {
  readonly baseUrl: string;
  readonly browser: Browser;
};

export type MarketingPreferencesBrowserFixture = {
  readonly logPath: string;
  readonly reportPath: string;
};

type MarketingPreferencesBrowserFixtureOptions =
  MarketingPreferencesFixtureOptions & {
    readonly timeoutMs?: number;
  };

const makeBrowserHtml = (
  javascriptPath: string,
  cssPath: string
) => `<!doctype html>
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

const serveBrowserBundle = async (
  bundle: Awaited<ReturnType<typeof buildMarketingPreferencesFixture>>,
  paths: BrowserFixturePaths
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
        body: await readFile(paths.rendererCssPath),
        type: "text/css; charset=utf-8",
      },
    ],
    [
      "/__account-visual-fonts/sculpin-regular.woff2",
      { body: await readFile(paths.regularFontPath), type: "font/woff2" },
    ],
    [
      "/__account-visual-fonts/sculpin-italic.woff2",
      { body: await readFile(paths.italicFontPath), type: "font/woff2" },
    ],
  ]);
  const html = makeBrowserHtml(bundle.javascriptPath, bundle.cssPath);
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

const readBrowserGeometry = async (page: Page): Promise<BrowserGeometry> =>
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
        "button, a, input, select, textarea, [role='checkbox'], [role='switch']"
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

const readBrowserActionLog = async (
  page: Page
): Promise<readonly BrowserActionEvent[]> =>
  page.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      readonly __marketingPreferencesActionLog?: {
        readonly events?: readonly BrowserActionEvent[];
      };
    };
    return [...(scope.__marketingPreferencesActionLog?.events ?? [])];
  });

const readBrowserFocusTarget = async (
  page: Page
): Promise<BrowserFocusTarget | null> =>
  page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement) || element === document.body)
      return null;
    const labelledBy = element.getAttribute("aria-labelledby");
    const labelledByLabel = labelledBy
      ? labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
          .filter(Boolean)
          .join(" ")
      : "";
    const label =
      (
        element.getAttribute("aria-label")?.trim() ||
        labelledByLabel ||
        (element.id
          ? document
              .querySelector<HTMLLabelElement>(
                `label[for="${CSS.escape(element.id)}"]`
              )
              ?.textContent?.trim()
          : undefined)
      )?.replace(/\s+/g, " ") ??
      element.textContent?.trim().replace(/\s+/g, " ") ??
      "";
    return {
      id: element.id,
      label,
      role: element.getAttribute("role"),
      tag: element.tagName.toLowerCase(),
    };
  });

const readBrowserKeyboardEvidence = async (page: Page) => {
  const sequence: BrowserFocusTarget[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < 32; index += 1) {
    await page.keyboard.press("Tab");
    const target = await readBrowserFocusTarget(page);
    if (!target || target.label.length === 0) continue;
    const key = `${target.tag}|${target.id}|${target.role ?? ""}|${target.label}`;
    if (seen.has(key)) break;
    seen.add(key);
    sequence.push(target);
  }
  return sequence;
};

const browserScenarioStatus = (scenario: BrowserScenario) => {
  if (scenario === "pending-link") return "pending-link";
  if (scenario === "unavailable") return "unavailable";
  if (scenario === "invalid-link") return "invalid-link";
  return scenario.split("-")[1];
};

const browserContextFor = (scenario: BrowserScenario, suffix = "a") =>
  `synthetic-${scenario}-context-${suffix}`;

const browserDismissalContextFor = (scenario: BrowserScenario, suffix = "a") =>
  `synthetic-${scenario}-dismissal-context-${suffix}`;

const browserQueryFor = (
  locale: BrowserLocale,
  scenario: BrowserScenario,
  extra: Readonly<Record<string, string>> = {}
) => {
  const params = new URLSearchParams({ case: scenario, locale, ...extra });
  return `/?${params.toString()}`;
};

const waitForBrowserBodyText = async (page: Page, text: string) => {
  await page.waitForFunction(
    (expected) => document.body.textContent?.includes(expected) ?? false,
    text,
    { timeout: 5_000 }
  );
};

const addBrowserPageDiagnostics = (page: Page, problems: BrowserProblems) => {
  page.on("pageerror", (error) => problems.pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") problems.consoleErrors.push(message.text());
  });
};

const loadBrowserPage = async (
  context: BrowserContext,
  baseUrl: string,
  locale: BrowserLocale,
  scenario: BrowserScenario,
  problems: BrowserProblems,
  extra: Readonly<Record<string, string>> = {}
) => {
  const page = await context.newPage();
  addBrowserPageDiagnostics(page, problems);
  await page.goto(`${baseUrl}${browserQueryFor(locale, scenario, extra)}`, {
    timeout: 15_000,
    waitUntil: "load",
  });
  await page
    .locator(
      `[data-marketing-preferences="${browserScenarioStatus(scenario)}"]`
    )
    .waitFor({ state: "visible", timeout: 15_000 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );
  });
  return page;
};

const assertBrowserGeometryAndKeyboard = async (
  page: Page
): Promise<{
  readonly focusSequence: readonly BrowserFocusTarget[];
  readonly geometry: BrowserGeometry;
}> => {
  const geometry = await readBrowserGeometry(page);
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

  const focusSequence = await readBrowserKeyboardEvidence(page);
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

const browserScreenshot = async ({
  context,
  locale,
  phase,
  scenario,
  viewport,
  page,
}: {
  readonly context: BrowserFixtureRunContext;
  readonly locale: BrowserLocale;
  readonly phase: string;
  readonly scenario: BrowserScenario;
  readonly viewport: BrowserViewport;
  readonly page: Page;
}): Promise<BrowserScreenshotEvidence> => {
  await page.evaluate(() => window.scrollTo(0, 0));
  const path = join(
    context.artifactRoot,
    `${phase}-${locale}-${viewport.name}-${scenario}.png`
  );
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path,
  });
  const { focusSequence, geometry } =
    await assertBrowserGeometryAndKeyboard(page);
  return {
    actions: await readBrowserActionLog(page),
    focusSequence,
    fullPage: true,
    geometry,
    locale,
    phase,
    scenario,
    screenshot: relative(context.repoRoot, path),
    viewport: viewport.name,
  } satisfies BrowserScreenshotEvidence;
};

const marketingSwitchFor = (page: Page) =>
  page.locator("#marketing-preferences-switch");

const assertCookieCategorySwitches = async (page: Page) => {
  const necessary = page.locator("#cookie-category-necessary");
  expect(await necessary.count()).toBe(1);
  expect(await necessary.getAttribute("aria-checked")).toBe("true");
  expect(await necessary.isDisabled()).toBe(true);
  for (const category of ["analytics", "marketing", "preferences"]) {
    const locator = page.locator(`#cookie-category-${category}`);
    expect(await locator.count()).toBe(1);
    expect(await locator.isDisabled()).toBe(false);
    expect(await locator.getAttribute("aria-checked")).toBe("false");
  }
};

const assertBrowserInitialState = async (
  page: Page,
  locale: BrowserLocale,
  scenario: BrowserScenario
) => {
  const section = page.locator(
    `[data-marketing-preferences="${browserScenarioStatus(scenario)}"]`
  );
  expect(await section.count()).toBe(1);
  await assertCookieCategorySwitches(page);
  const marketingSwitchCount = await marketingSwitchFor(page).count();

  if (scenario === "pending-link") {
    expect(
      await page
        .getByRole("button", {
          name: m.marketingPreferencesFormContinueAction({}, { locale }),
        })
        .count()
    ).toBe(1);
    expect(
      await page
        .getByRole("button", {
          name: m.marketingPreferencesFormClearAction({}, { locale }),
        })
        .count()
    ).toBe(1);
    expect(marketingSwitchCount).toBe(0);
    expect(
      await page
        .getByText(m.marketingPreferencesFormPendingDescription({}, { locale }))
        .count()
    ).toBe(1);
    return;
  }

  if (scenario === "unavailable") {
    expect(
      await page
        .getByText(
          m.marketingPreferencesFormUnavailableNextStep({}, { locale })
        )
        .count()
    ).toBe(1);
    expect(
      await page
        .getByText(
          m.marketingPreferencesFormUnavailableSignInNextStep({}, { locale })
        )
        .count()
    ).toBe(1);
    expect(
      await page
        .getByRole("link", {
          name: m.marketingPreferencesFormSignInAction({}, { locale }),
        })
        .getAttribute("href")
    ).toBe(`/${locale}/auth/sign-in`);
    expect(marketingSwitchCount).toBe(0);
    expect(
      await page
        .getByRole("button", {
          name: m.marketingPreferencesFormContinueAction({}, { locale }),
        })
        .count()
    ).toBe(0);
    return;
  }

  if (scenario === "invalid-link") {
    expect(
      await page
        .getByText(
          m.marketingPreferencesFormInvalidLinkDescription({}, { locale })
        )
        .count()
    ).toBe(1);
    expect(
      await page
        .getByRole("link", {
          name: m.marketingPreferencesFormSignInAction({}, { locale }),
        })
        .count()
    ).toBe(0);
    expect(marketingSwitchCount).toBe(0);
    expect(
      await page
        .getByRole("button", {
          name: m.marketingPreferencesFormContinueAction({}, { locale }),
        })
        .count()
    ).toBe(0);
    expect(
      await page
        .getByRole("button", {
          name: m.marketingPreferencesFormClearAction({}, { locale }),
        })
        .count()
    ).toBe(1);
    return;
  }

  const source = scenario.startsWith("link-") ? "link" : "account";
  const status = scenario.split("-")[1];
  expect(marketingSwitchCount).toBe(1);
  expect(await marketingSwitchFor(page).getAttribute("aria-checked")).toBe(
    status === "active" ? "true" : "false"
  );
  expect(await marketingSwitchFor(page).isDisabled()).toBe(false);
  // No confirmation-gate buttons render inside the managed row; the only
  // row control besides the switch is the link clear action.
  const managedRow = page.locator(
    '[data-marketing-preferences-source]:not([data-marketing-preferences-source=""])'
  );
  expect(await managedRow.getByRole("button").count()).toBe(
    source === "link" ? 1 : 0
  );
  expect(
    await page
      .getByText(
        source === "link"
          ? m.marketingPreferencesFormAccountContext({}, { locale })
          : m.marketingPreferencesFormLinkContext({}, { locale })
      )
      .count()
  ).toBe(0);
  if (source === "link") {
    expect(
      await page
        .getByText(m.marketingPreferencesFormLinkContext({}, { locale }))
        .count()
    ).toBe(1);
    expect(
      await page
        .getByRole("button", {
          name: m.marketingPreferencesFormClearAction({}, { locale }),
        })
        .count()
    ).toBe(1);
  } else {
    expect(
      await page
        .getByRole("button", {
          name: m.marketingPreferencesFormClearAction({}, { locale }),
        })
        .count()
    ).toBe(0);
  }
};

const assertBrowserActionEvent = (
  event: BrowserActionEvent | undefined,
  expected: {
    readonly action: BrowserActionEvent["action"];
    readonly input?: Partial<BrowserActionEvent["input"]>;
  }
) => {
  expect(event).toBeDefined();
  expect(event).toMatchObject(expected);
};

const createBrowserContext = async (
  runningBrowser: Browser,
  baseUrl: string,
  viewport: BrowserViewport,
  locale: BrowserLocale,
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

const runBrowserInitialCapture = async ({
  context,
  locale,
  problems,
  scenario,
  viewport,
}: {
  readonly context: BrowserFixtureRunContext;
  readonly locale: BrowserLocale;
  readonly problems: BrowserProblems;
  readonly scenario: BrowserScenario;
  readonly viewport: BrowserViewport;
}) => {
  const pageContext = await createBrowserContext(
    context.browser,
    context.baseUrl,
    viewport,
    locale,
    problems
  );
  const page = await loadBrowserPage(
    pageContext,
    context.baseUrl,
    locale,
    scenario,
    problems
  );
  try {
    await assertBrowserInitialState(page, locale, scenario);
    return await browserScreenshot({
      context,
      locale,
      page,
      phase: "state",
      scenario,
      viewport,
    });
  } finally {
    await page.close();
    await pageContext.close();
  }
};

const runBrowserPendingTransitions = async ({
  context,
  locale,
  problems,
  viewport,
}: {
  readonly context: BrowserFixtureRunContext;
  readonly locale: BrowserLocale;
  readonly problems: BrowserProblems;
  readonly viewport: BrowserViewport;
}) => {
  const evidence: BrowserScreenshotEvidence[] = [];
  const pageContext = await createBrowserContext(
    context.browser,
    context.baseUrl,
    viewport,
    locale,
    problems
  );
  try {
    const successPage = await loadBrowserPage(
      pageContext,
      context.baseUrl,
      locale,
      "pending-link",
      problems,
      { confirmOutcome: "success" }
    );
    try {
      await successPage
        .getByRole("button", {
          name: m.marketingPreferencesFormContinueAction({}, { locale }),
        })
        .click();
      await waitForBrowserBodyText(
        successPage,
        m.marketingPreferencesFormConfirmed({}, { locale })
      );
      assertBrowserActionEvent((await readBrowserActionLog(successPage))[0], {
        action: "confirm",
        input: { context: browserContextFor("pending-link") },
      });
      evidence.push(
        await browserScreenshot({
          context,
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

    const errorPage = await loadBrowserPage(
      pageContext,
      context.baseUrl,
      locale,
      "pending-link",
      problems,
      { confirmOutcome: "error" }
    );
    try {
      await errorPage
        .getByRole("button", {
          name: m.marketingPreferencesFormContinueAction({}, { locale }),
        })
        .click();
      await errorPage
        .getByRole("alert")
        .waitFor({ state: "visible", timeout: 5_000 });
      expect(
        await errorPage
          .getByText(
            m.marketingPreferencesFormPendingDescription({}, { locale })
          )
          .count()
      ).toBe(1);
      expect(await marketingSwitchFor(errorPage).count()).toBe(0);
      assertBrowserActionEvent((await readBrowserActionLog(errorPage))[0], {
        action: "confirm",
        input: { context: browserContextFor("pending-link") },
      });
      evidence.push(
        await browserScreenshot({
          context,
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
    await pageContext.close();
  }
  return evidence;
};

const runBrowserSaveTransitions = async ({
  context,
  locale,
  problems,
  scenario,
  viewport,
}: {
  readonly context: BrowserFixtureRunContext;
  readonly locale: BrowserLocale;
  readonly problems: BrowserProblems;
  readonly scenario: "account-absent" | "account-active" | "account-withdrawn";
  readonly viewport: BrowserViewport;
}) => {
  const evidence: BrowserScreenshotEvidence[] = [];
  const pageContext = await createBrowserContext(
    context.browser,
    context.baseUrl,
    viewport,
    locale,
    problems
  );
  try {
    const source = "account" as const;
    const granted = scenario !== "account-active";
    for (const outcome of ["success", "error", "transport"] as const) {
      const page = await loadBrowserPage(
        pageContext,
        context.baseUrl,
        locale,
        scenario,
        problems,
        { delay: "200", saveOutcome: outcome }
      );
      try {
        const marketingSwitch = marketingSwitchFor(page);
        const initialChecked =
          await marketingSwitch.getAttribute("aria-checked");
        expect(await readBrowserActionLog(page)).toEqual([]);
        await marketingSwitch.click();
        expect(await marketingSwitch.isDisabled()).toBe(true);
        if (outcome === "success") {
          await waitForBrowserBodyText(
            page,
            m.marketingPreferencesFormSaved({}, { locale })
          );
          expect(await marketingSwitch.getAttribute("aria-checked")).toBe(
            granted ? "true" : "false"
          );
        } else {
          await page
            .getByRole("alert")
            .waitFor({ state: "visible", timeout: 5_000 });
          await waitForBrowserBodyText(
            page,
            m.marketingPreferencesFormSaveError({}, { locale })
          );
          expect(await marketingSwitch.getAttribute("aria-checked")).toBe(
            initialChecked
          );
        }
        expect(await marketingSwitch.isDisabled()).toBe(false);
        const actionEvents = await readBrowserActionLog(page);
        assertBrowserActionEvent(actionEvents[0], {
          action: "save",
          input: {
            context: browserContextFor(scenario),
            granted,
            source,
          },
        });
        if (outcome === "transport") {
          expect(
            actionEvents.some(({ action }) => action === "transport-error")
          ).toBe(true);
        } else if (outcome === "error") {
          expect(
            actionEvents.some(({ action }) => action === "transport-error")
          ).toBe(false);
        }
        evidence.push(
          await browserScreenshot({
            context,
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
    await pageContext.close();
  }
  return evidence;
};

const runBrowserLinkClearTransitions = async ({
  context,
  locale,
  problems,
  viewport,
}: {
  readonly context: BrowserFixtureRunContext;
  readonly locale: BrowserLocale;
  readonly problems: BrowserProblems;
  readonly viewport: BrowserViewport;
}) => {
  const evidence: BrowserScreenshotEvidence[] = [];
  const pageContext = await createBrowserContext(
    context.browser,
    context.baseUrl,
    viewport,
    locale,
    problems
  );
  try {
    for (const outcome of ["success", "error"] as const) {
      const page = await loadBrowserPage(
        pageContext,
        context.baseUrl,
        locale,
        "link-active",
        problems,
        { clearOutcome: outcome }
      );
      try {
        await page
          .getByRole("button", {
            name: m.marketingPreferencesFormClearAction({}, { locale }),
          })
          .click();
        if (outcome === "success") {
          await waitForBrowserBodyText(
            page,
            m.marketingPreferencesFormCleared({}, { locale })
          );
        } else {
          await page
            .getByRole("alert")
            .waitFor({ state: "visible", timeout: 5_000 });
          await waitForBrowserBodyText(
            page,
            m.marketingPreferencesFormClearError({}, { locale })
          );
        }
        assertBrowserActionEvent((await readBrowserActionLog(page))[0], {
          action: "clear",
          input: {
            context: browserDismissalContextFor("link-active"),
          },
        });
        evidence.push(
          await browserScreenshot({
            context,
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
    await pageContext.close();
  }
  return evidence;
};

const runBrowserContextReplacement = async ({
  context,
  locale,
  problems,
  viewport,
}: {
  readonly context: BrowserFixtureRunContext;
  readonly locale: BrowserLocale;
  readonly problems: BrowserProblems;
  readonly viewport: BrowserViewport;
}) => {
  const pageContext = await createBrowserContext(
    context.browser,
    context.baseUrl,
    viewport,
    locale,
    problems
  );
  const page = await loadBrowserPage(
    pageContext,
    context.baseUrl,
    locale,
    "link-absent",
    problems,
    { context: "a" }
  );
  try {
    const marketingSwitch = marketingSwitchFor(page);
    await marketingSwitch.click();
    await waitForBrowserBodyText(
      page,
      m.marketingPreferencesFormSaved({}, { locale })
    );
    expect(await marketingSwitch.getAttribute("aria-checked")).toBe("true");
    const before = await browserScreenshot({
      context,
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
          .querySelector("#marketing-preferences-switch")
          ?.getAttribute("aria-checked") === "false",
      undefined,
      { timeout: 5_000 }
    );
    expect(await marketingSwitchFor(page).count()).toBe(1);
    expect(await marketingSwitchFor(page).isDisabled()).toBe(false);
    const eventsAfterReplacement = await readBrowserActionLog(page);
    expect(eventsAfterReplacement).toHaveLength(1);
    assertBrowserActionEvent(eventsAfterReplacement[0], {
      action: "save",
      input: { granted: true, source: "link" },
    });
    const after = await browserScreenshot({
      context,
      locale,
      page,
      phase: "context-replacement-reset",
      scenario: "link-absent",
      viewport,
    });
    return [before, after] as const;
  } finally {
    await page.close();
    await pageContext.close();
  }
};

const runBrowserCookieToggleTransitions = async ({
  context,
  locale,
  problems,
  viewport,
}: {
  readonly context: BrowserFixtureRunContext;
  readonly locale: BrowserLocale;
  readonly problems: BrowserProblems;
  readonly viewport: BrowserViewport;
}) => {
  const evidence: BrowserScreenshotEvidence[] = [];
  const pageContext = await createBrowserContext(
    context.browser,
    context.baseUrl,
    viewport,
    locale,
    problems
  );
  const page = await loadBrowserPage(
    pageContext,
    context.baseUrl,
    locale,
    "account-absent",
    problems,
    { cookieDelay: "250" }
  );
  try {
    const marketingCookieSwitch = page.locator("#cookie-category-marketing");
    const necessarySwitch = page.locator("#cookie-category-necessary");
    const messagesSwitch = marketingSwitchFor(page);
    expect(await marketingCookieSwitch.getAttribute("aria-checked")).toBe(
      "false"
    );
    expect(await messagesSwitch.getAttribute("aria-checked")).toBe("false");
    expect(await readBrowserActionLog(page)).toEqual([]);
    await marketingCookieSwitch.click();
    expect(await marketingCookieSwitch.isDisabled()).toBe(true);
    expect(await marketingCookieSwitch.getAttribute("aria-checked")).toBe(
      "true"
    );
    expect(await necessarySwitch.getAttribute("aria-checked")).toBe("true");
    expect(await necessarySwitch.isDisabled()).toBe(true);
    evidence.push(
      await browserScreenshot({
        context,
        locale,
        page,
        phase: "cookie-toggle-pending",
        scenario: "account-absent",
        viewport,
      })
    );
    await page.waitForFunction(
      () =>
        !(
          document.getElementById(
            "cookie-category-marketing"
          ) as HTMLButtonElement | null
        )?.disabled,
      undefined,
      { timeout: 5_000 }
    );
    expect(await marketingCookieSwitch.getAttribute("aria-checked")).toBe(
      "true"
    );
    expect(await messagesSwitch.getAttribute("aria-checked")).toBe("false");
    expect(await necessarySwitch.getAttribute("aria-checked")).toBe("true");
    expect(await necessarySwitch.isDisabled()).toBe(true);
    expect(await readBrowserActionLog(page)).toEqual([]);
    evidence.push(
      await browserScreenshot({
        context,
        locale,
        page,
        phase: "cookie-toggle-done",
        scenario: "account-absent",
        viewport,
      })
    );
  } finally {
    await page.close();
    await pageContext.close();
  }
  return evidence;
};

const runBrowserAccountsDisabledChecks = async ({
  context,
  locale,
  problems,
  viewport,
}: {
  readonly context: BrowserFixtureRunContext;
  readonly locale: BrowserLocale;
  readonly problems: BrowserProblems;
  readonly viewport: BrowserViewport;
}) => {
  const pageContext = await createBrowserContext(
    context.browser,
    context.baseUrl,
    viewport,
    locale,
    problems
  );
  try {
    const unavailablePage = await loadBrowserPage(
      pageContext,
      context.baseUrl,
      locale,
      "unavailable",
      problems,
      { accountsEnabled: "false" }
    );
    try {
      expect(
        await unavailablePage
          .getByText(
            m.marketingPreferencesFormUnavailableNextStep({}, { locale })
          )
          .count()
      ).toBe(1);
      expect(
        await unavailablePage
          .getByText(
            m.marketingPreferencesFormUnavailableSignInNextStep({}, { locale })
          )
          .count()
      ).toBe(0);
      expect(
        await unavailablePage
          .getByRole("link", {
            name: m.marketingPreferencesFormSignInAction({}, { locale }),
          })
          .count()
      ).toBe(0);
    } finally {
      await unavailablePage.close();
    }

    const pendingPage = await loadBrowserPage(
      pageContext,
      context.baseUrl,
      locale,
      "pending-link",
      problems,
      { accountsEnabled: "false", confirmOutcome: "success" }
    );
    try {
      const continueButton = pendingPage.getByRole("button", {
        name: m.marketingPreferencesFormContinueAction({}, { locale }),
      });
      expect(await continueButton.count()).toBe(1);
      await continueButton.click();
      await waitForBrowserBodyText(
        pendingPage,
        m.marketingPreferencesFormConfirmed({}, { locale })
      );
      assertBrowserActionEvent((await readBrowserActionLog(pendingPage))[0], {
        action: "confirm",
        input: { context: browserContextFor("pending-link") },
      });
    } finally {
      await pendingPage.close();
    }
  } finally {
    await pageContext.close();
  }
};

const runMarketingPreferencesBrowserFixture = async ({
  appRoot,
  outputDirectory,
}: MarketingPreferencesFixtureOptions): Promise<MarketingPreferencesBrowserFixture> => {
  const paths: BrowserFixturePaths = {
    adapterPath: join(import.meta.dir, "marketing-preferences-adapter.tsx"),
    artifactRoot: outputDirectory,
    italicFontPath: join(appRoot, "assets/fonts/Sculpin/italic.woff2"),
    productionFormPath: join(
      appRoot,
      "features/legal/components/marketing-preferences-form.tsx"
    ),
    productionCookieSettingsPath: join(
      appRoot,
      "features/cookie-consent/components/cookie-settings-page.tsx"
    ),
    regularFontPath: join(appRoot, "assets/fonts/Sculpin/regular.woff2"),
    rendererCssPath: join(import.meta.dir, "renderer.css"),
    repoRoot: browserRepoRoot,
  };
  const reportPath = join(outputDirectory, "report.json");
  const logPath = join(outputDirectory, "browser.log");
  await rm(outputDirectory, { force: true, recursive: true });
  await mkdir(outputDirectory, { recursive: true });
  const bundle = await compileMarketingPreferencesFixture({
    appRoot,
    outputDirectory,
  });
  const staticServer = await serveBrowserBundle(bundle, paths);
  const problems: BrowserProblems = {
    consoleErrors: [],
    externalRequests: [],
    pageErrors: [],
  };
  const screenshots: BrowserScreenshotEvidence[] = [];
  const logLines: string[] = [
    "scope=component-only controlled renderer",
    "authorization=not-proved",
    "cookies=not-proved",
    "tokens=not-proved",
    `server=${staticServer.baseUrl} (ephemeral localhost port)`,
  ];
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true, timeout: 20_000 });
    const context: BrowserFixtureRunContext = {
      ...paths,
      baseUrl: staticServer.baseUrl,
      browser,
    };
    for (const locale of browserLocales) {
      for (const viewport of browserViewports) {
        for (const scenario of browserScenarios) {
          const evidence = await runBrowserInitialCapture({
            context,
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
          await runBrowserAccountsDisabledChecks({
            context,
            locale,
            problems,
            viewport,
          });
        }
        for (const evidence of await runBrowserPendingTransitions({
          context,
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
          for (const evidence of await runBrowserSaveTransitions({
            context,
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
        for (const evidence of await runBrowserLinkClearTransitions({
          context,
          locale,
          problems,
          viewport,
        })) {
          screenshots.push(evidence);
          logLines.push(
            `${evidence.phase} ${locale}/${viewport.name}/${evidence.scenario} ${evidence.screenshot}`
          );
        }
        for (const evidence of await runBrowserContextReplacement({
          context,
          locale,
          problems,
          viewport,
        })) {
          screenshots.push(evidence);
          logLines.push(
            `${evidence.phase} ${locale}/${viewport.name}/${evidence.scenario} ${evidence.screenshot}`
          );
        }
        for (const evidence of await runBrowserCookieToggleTransitions({
          context,
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
    expect(screenshots).toHaveLength(208);
    expect(screenshots.every(({ fullPage }) => fullPage)).toBe(true);
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
        adapter: relative(paths.repoRoot, paths.adapterPath),
        productionComponent: relative(paths.repoRoot, paths.productionFormPath),
        productionCookieSettings: relative(
          paths.repoRoot,
          paths.productionCookieSettingsPath
        ),
        controlledModules: [
          "@/features/legal/actions",
          "@/shared/utils/use-workspace-action",
          "@/features/cookie-consent",
        ],
        bundle: {
          entry: relative(paths.repoRoot, bundle.entryPath),
          javascript: relative(paths.repoRoot, bundle.javascriptPath),
          css: relative(paths.repoRoot, bundle.cssPath),
        },
      },
      browser: {
        engine: "Chromium",
        version: browser?.version() ?? "unknown",
        bunVersion: Bun.version,
        viewports: browserViewports,
        locales: browserLocales,
      },
      syntheticScenarios: browserScenarios,
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
        cookieSettingsComposition: true,
        necessaryCategoryLockedOn: true,
        cookieTogglesImmediateAndDisabledPending: true,
        marketingMessagesSwitchDistinctFromCookieSwitches: true,
        marketingSaveFailureRetainsChecked: true,
        marketingSaveDisabledWhileInFlight: true,
      },
      problems,
      screenshots,
    };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await writeFile(logPath, `${logLines.join("\n")}\n`, "utf8");
  } finally {
    const runningBrowser = browser;
    try {
      try {
        await staticServer.server.stop(true);
      } finally {
        await writeFile(logPath, `${logLines.join("\n")}\n`, "utf8");
      }
    } finally {
      browser = undefined;
      await runningBrowser?.close();
    }
  }
  return { logPath, reportPath };
};

const maxFixtureStdoutBytes = 64 * 1024;
const defaultFixtureTimeoutMs = 60_000;
// Bounded wait for a SIGKILLed fixture child to settle after the deadline
// kill. Prompt deaths resolve in milliseconds; this only caps a wedged
// child under extreme runner load.
const defaultTerminationGraceMs = 30_000;

const isWithin = (parent: string, child: string): boolean => {
  const childRelative = relative(parent, child);
  return (
    childRelative === "" ||
    (!childRelative.startsWith("..") && !isAbsolute(childRelative))
  );
};

const readBoundedStdout = async (
  stream: ReadableStream<Uint8Array>
): Promise<string> => {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxFixtureStdoutBytes) {
        throw new Error("fixture child stdout limit exceeded");
      }
      chunks.push(next.value);
    }
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // The child is terminated by the caller after a read failure.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(output);
  } catch {
    throw new Error("fixture child stdout was not valid UTF-8");
  }
};

const hasExactKeys = (value: JsonObject, keys: readonly string[]): boolean => {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
};

const parseFixtureMessage = (stdout: string): FixtureMessage => {
  let value: JsonObject;
  try {
    value = Schema.decodeUnknownSync(jsonObjectSchema)(JSON.parse(stdout));
  } catch {
    throw new Error(
      "Marketing preferences fixture child returned malformed JSON"
    );
  }
  if (!Predicate.isString(value.status)) {
    throw new Error(
      "Marketing preferences fixture child returned an invalid result"
    );
  }

  if (value.status === "error") {
    if (!hasExactKeys(value, ["status", "message"])) {
      throw new Error(
        "Marketing preferences fixture child returned an invalid error result"
      );
    }
    try {
      const result = Schema.decodeUnknownSync(fixtureErrorSchema)(value);
      return {
        message: formatBuildDiagnostics(result.message),
        status: result.status,
      };
    } catch {
      throw new Error(
        "Marketing preferences fixture child returned an invalid error result"
      );
    }
  }

  if (value.status !== "ok") {
    throw new Error(
      "Marketing preferences fixture child returned an unknown result status"
    );
  }
  if (
    !hasExactKeys(value, [
      "status",
      "bunVersion",
      "cssPath",
      "entryPath",
      "javascriptPath",
      "scheduler",
    ]) ||
    !Predicate.isObject(value.scheduler) ||
    Object.keys(value.scheduler).length !== 2 ||
    !Object.hasOwn(value.scheduler, "path") ||
    !Object.hasOwn(value.scheduler, "bytes")
  ) {
    throw new Error(
      "Marketing preferences fixture child returned an invalid success result"
    );
  }

  try {
    return Schema.decodeUnknownSync(fixtureSuccessSchema)(value);
  } catch {
    throw new Error(
      "Marketing preferences fixture child returned an invalid success result"
    );
  }
};

const parseBrowserMessage = (stdout: string): BrowserMessage => {
  let value: JsonObject;
  try {
    value = Schema.decodeUnknownSync(jsonObjectSchema)(JSON.parse(stdout));
  } catch {
    throw new Error(
      "Marketing preferences browser child returned malformed JSON"
    );
  }
  if (!Predicate.isString(value.status)) {
    throw new Error(
      "Marketing preferences browser child returned an invalid result"
    );
  }

  if (value.status === "error") {
    if (!hasExactKeys(value, ["status", "message"])) {
      throw new Error(
        "Marketing preferences browser child returned an invalid error result"
      );
    }
    try {
      const result = Schema.decodeUnknownSync(fixtureErrorSchema)(value);
      return {
        message: formatBuildDiagnostics(result.message),
        status: result.status,
      };
    } catch {
      throw new Error(
        "Marketing preferences browser child returned an invalid error result"
      );
    }
  }

  if (value.status !== "ok") {
    throw new Error(
      "Marketing preferences browser child returned an unknown result status"
    );
  }
  if (!hasExactKeys(value, ["status", "bunVersion", "reportPath", "logPath"])) {
    throw new Error(
      "Marketing preferences browser child returned an invalid success result"
    );
  }

  try {
    return Schema.decodeUnknownSync(browserSuccessSchema)(value);
  } catch {
    throw new Error(
      "Marketing preferences browser child returned an invalid success result"
    );
  }
};

const readRegularNonEmptyFile = async (
  path: string,
  label: string
): Promise<Uint8Array> => {
  let fileStats: Awaited<ReturnType<typeof stat>>;
  try {
    fileStats = await stat(path);
  } catch {
    throw new Error(`${label} is missing`);
  }
  if (!fileStats.isFile()) throw new Error(`${label} is not a regular file`);
  let bytes: Uint8Array;
  try {
    bytes = await readFile(path);
  } catch {
    throw new Error(`${label} could not be read`);
  }
  if (bytes.byteLength === 0) throw new Error(`${label} is empty`);
  return bytes;
};

const validateOutputFile = async ({
  outputDirectory,
  outputDirectoryRealPath,
  path,
  extension,
  label,
}: {
  readonly outputDirectory: string;
  readonly outputDirectoryRealPath: string;
  readonly path: string;
  readonly extension?: string;
  readonly label: string;
}): Promise<void> => {
  if (!isAbsolute(path)) throw new Error(`${label} path is not absolute`);
  const resolvedOutputDirectory = resolve(outputDirectory);
  const resolvedPath = resolve(path);
  if (!isWithin(resolvedOutputDirectory, resolvedPath)) {
    throw new Error(`${label} path escapes the output directory`);
  }
  if (extension !== undefined && extname(path) !== extension) {
    throw new Error(`${label} path has the wrong extension`);
  }

  let realPath: string;
  try {
    realPath = await realpath(resolvedPath);
  } catch {
    throw new Error(`${label} path is missing`);
  }
  if (!isWithin(outputDirectoryRealPath, realPath)) {
    throw new Error(`${label} path escapes the output directory`);
  }
  await readRegularNonEmptyFile(realPath, label);
};

const validateScheduler = async (
  scheduler: SchedulerEvidence
): Promise<void> => {
  if (!isAbsolute(scheduler.path)) {
    throw new Error("Scheduler evidence path is not absolute");
  }
  const realPath = await realpath(scheduler.path).catch(() => {
    throw new Error("Scheduler evidence path is missing");
  });
  const bytes = await readRegularNonEmptyFile(realPath, "Scheduler source");
  if (bytes.byteLength !== scheduler.bytes) {
    throw new Error("Scheduler evidence byte count does not match the source");
  }
};

const validateFixtureSuccess = async (
  message: FixtureSuccessMessage,
  outputDirectory: string
): Promise<MarketingPreferencesFixture> => {
  if (message.bunVersion !== Bun.version) {
    throw new Error("Marketing preferences fixture Bun version mismatch");
  }
  let outputDirectoryRealPath: string;
  try {
    outputDirectoryRealPath = await realpath(resolve(outputDirectory));
  } catch {
    throw new Error(
      "Marketing preferences fixture output directory is missing"
    );
  }
  await validateOutputFile({
    extension: ".css",
    label: "Marketing preferences CSS output",
    outputDirectory,
    outputDirectoryRealPath,
    path: message.cssPath,
  });
  await validateOutputFile({
    label: "Marketing preferences entry",
    outputDirectory,
    outputDirectoryRealPath,
    path: message.entryPath,
  });
  await validateOutputFile({
    extension: ".js",
    label: "Marketing preferences JavaScript output",
    outputDirectory,
    outputDirectoryRealPath,
    path: message.javascriptPath,
  });
  await validateScheduler(message.scheduler);
  return {
    cssPath: message.cssPath,
    entryPath: message.entryPath,
    javascriptPath: message.javascriptPath,
    scheduler: message.scheduler,
  };
};

const validateBrowserSuccess = async (
  message: BrowserSuccessMessage,
  outputDirectory: string
): Promise<MarketingPreferencesBrowserFixture> => {
  if (message.bunVersion !== Bun.version) {
    throw new Error("Marketing preferences browser Bun version mismatch");
  }
  let outputDirectoryRealPath: string;
  try {
    outputDirectoryRealPath = await realpath(resolve(outputDirectory));
  } catch {
    throw new Error(
      "Marketing preferences browser output directory is missing"
    );
  }
  await validateOutputFile({
    extension: ".json",
    label: "Marketing preferences browser report",
    outputDirectory,
    outputDirectoryRealPath,
    path: message.reportPath,
  });
  await validateOutputFile({
    extension: ".log",
    label: "Marketing preferences browser log",
    outputDirectory,
    outputDirectoryRealPath,
    path: message.logPath,
  });
  return { logPath: message.logPath, reportPath: message.reportPath };
};

const terminateFixtureChild = async (
  child: Bun.Subprocess,
  exitPromise: Promise<number>
): Promise<void> => {
  try {
    child.kill("SIGKILL");
  } catch {
    // The child may have exited between the failure and the kill request.
  }
  await exitPromise.catch(() => undefined);
};

type FixtureChildMessages = {
  readonly exitFailed: string;
  readonly invalidTimeout: string;
  readonly launch: string;
  readonly stdoutFailed: string;
  readonly stdoutUnavailable: string;
  readonly timeout: (timeoutMs: number) => string;
};

type FixtureChildResult = {
  readonly exitCode: number;
  readonly stdout: string;
};

const runBoundedFixtureChild = async ({
  args,
  cwd,
  messages,
  terminationGraceMs,
  timeoutMs,
}: {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly messages: FixtureChildMessages;
  readonly terminationGraceMs?: number;
  readonly timeoutMs: number;
}): Promise<FixtureChildResult> => {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new Error(messages.invalidTimeout);
  }

  let child: Bun.Subprocess;
  try {
    child = Bun.spawn([process.execPath, "run", import.meta.path, ...args], {
      cwd,
      stderr: "ignore",
      stdin: "ignore",
      stdout: "pipe",
    });
  } catch {
    throw new Error(messages.launch);
  }

  const exitPromise = child.exited;
  let terminationRequested = false;
  const terminate = async () => {
    if (terminationRequested) {
      await exitPromise.catch(() => undefined);
      return;
    }
    terminationRequested = true;
    await terminateFixtureChild(child, exitPromise);
  };
  let timedOut = false;
  type DeadlineOutcome = { readonly kind: "grace-expired" | "terminated" };
  // One stable deferred created before the race; the deadline callbacks
  // resolve THIS promise. The promise object registered with the race must
  // never be replaced, or the grace path never participates.
  let resolveDeadlineOutcome!: (outcome: DeadlineOutcome) => void;
  const deadlineOutcome = new Promise<DeadlineOutcome>((resolve) => {
    resolveDeadlineOutcome = resolve;
  });
  const graceTimers: ReturnType<typeof setNativeTimeout>[] = [];
  const graceBudgetMs = terminationGraceMs ?? defaultTerminationGraceMs;
  const timer = setNativeTimeout(() => {
    timedOut = true;
    // Termination is awaited with a bounded grace: a SIGKILLed child dies
    // immediately in practice, but a wedged child under extreme runner
    // load must not hold the parent past the caller's own test budget.
    const exitOutcome = terminate().then<DeadlineOutcome>(() => ({
      kind: "terminated",
    }));
    const graceTimer = setNativeTimeout(() => {
      resolveDeadlineOutcome({ kind: "grace-expired" });
    }, graceBudgetMs);
    graceTimers.push(graceTimer);
    // terminate() never rejects (kill failures are swallowed); attaching
    // this handler keeps the abandoned exit outcome rejection-free.
    void exitOutcome.then((value) => {
      clearNativeTimeout(graceTimer);
      resolveDeadlineOutcome(value);
    });
  }, timeoutMs);
  if (!(child.stdout instanceof ReadableStream)) {
    clearNativeTimeout(timer);
    await terminate();
    throw new Error(messages.stdoutUnavailable);
  }
  const stdoutPromise = readBoundedStdout(child.stdout).catch(async (error) => {
    await terminate();
    throw error;
  });
  const childSettled = await Promise.race([
    Promise.allSettled([stdoutPromise, exitPromise]).then((results) => ({
      kind: "child-settled" as const,
      results,
    })),
    deadlineOutcome,
  ]);
  for (const graceTimer of graceTimers) clearNativeTimeout(graceTimer);
  clearNativeTimeout(timer);

  if (timedOut || childSettled.kind !== "child-settled") {
    throw new Error(messages.timeout(timeoutMs));
  }
  const [stdoutResult, exitResult] = childSettled.results;
  if (stdoutResult.status === "rejected") {
    throw new Error(messages.stdoutFailed);
  }
  if (exitResult.status === "rejected") {
    await terminate();
    throw new Error(messages.exitFailed);
  }
  return { exitCode: exitResult.value, stdout: stdoutResult.value };
};

export async function compileMarketingPreferencesFixture({
  appRoot,
  outputDirectory,
  terminationGraceMs,
  timeoutMs,
}: MarketingPreferencesFixtureOptions & {
  readonly timeoutMs?: number;
}): Promise<MarketingPreferencesFixture> {
  const deadline = timeoutMs ?? defaultFixtureTimeoutMs;
  const { exitCode, stdout } = await runBoundedFixtureChild({
    args: ["--app-root", appRoot, "--output-directory", outputDirectory],
    cwd: appRoot,
    messages: {
      exitFailed: "Marketing preferences fixture child exit failed",
      invalidTimeout: "Marketing preferences fixture timeout is invalid",
      launch: "Could not launch marketing preferences fixture child",
      stdoutFailed: "Marketing preferences fixture child stdout failed",
      stdoutUnavailable:
        "Marketing preferences fixture child stdout was unavailable",
      timeout: (duration) =>
        `Marketing preferences fixture child timed out after ${duration}ms`,
    },
    timeoutMs: deadline,
    terminationGraceMs,
  });

  let message: FixtureMessage;
  try {
    message = parseFixtureMessage(stdout);
  } catch (error) {
    if (exitCode !== 0)
      throw new Error(
        `Marketing preferences fixture child exited with code ${exitCode}`
      );
    throw error;
  }
  if (exitCode !== 0) {
    if (message.status === "error") {
      throw new Error(
        `Marketing preferences fixture child failed: ${message.message}`
      );
    }
    throw new Error(
      `Marketing preferences fixture child exited with code ${exitCode}`
    );
  }
  if (message.status === "error") {
    throw new Error(
      `Marketing preferences fixture child failed: ${message.message}`
    );
  }
  return validateFixtureSuccess(message, outputDirectory);
}

const defaultBrowserFixtureTimeoutMs = 480_000;

export async function verifyMarketingPreferencesBrowserFixture({
  appRoot,
  outputDirectory,
  terminationGraceMs,
  timeoutMs,
}: MarketingPreferencesBrowserFixtureOptions): Promise<MarketingPreferencesBrowserFixture> {
  const deadline = timeoutMs ?? defaultBrowserFixtureTimeoutMs;
  const { exitCode, stdout } = await runBoundedFixtureChild({
    args: [
      "--browser",
      "--app-root",
      appRoot,
      "--output-directory",
      outputDirectory,
    ],
    cwd: appRoot,
    messages: {
      exitFailed: "Marketing preferences browser child exit failed",
      invalidTimeout: "Marketing preferences browser timeout is invalid",
      launch: "Could not launch marketing preferences browser child",
      stdoutFailed: "Marketing preferences browser child stdout failed",
      stdoutUnavailable:
        "Marketing preferences browser child stdout was unavailable",
      timeout: (duration) =>
        `Marketing preferences browser child timed out after ${duration}ms`,
    },
    timeoutMs: deadline,
    terminationGraceMs,
  });

  let message: BrowserMessage;
  try {
    message = parseBrowserMessage(stdout);
  } catch (error) {
    if (exitCode !== 0)
      throw new Error(
        `Marketing preferences browser child exited with code ${exitCode}`
      );
    throw error;
  }
  if (exitCode !== 0) {
    if (message.status === "error") {
      throw new Error(
        `Marketing preferences browser child failed: ${message.message}`
      );
    }
    throw new Error(
      `Marketing preferences browser child exited with code ${exitCode}`
    );
  }
  if (message.status === "error") {
    throw new Error(
      `Marketing preferences browser child failed: ${message.message}`
    );
  }
  return validateBrowserSuccess(message, outputDirectory);
}

const parseCliArguments = (
  args: readonly string[]
): MarketingPreferencesFixtureOptions => {
  const appRoot = args[1];
  const outputDirectory = args[3];
  if (
    args.length !== 4 ||
    args[0] !== "--app-root" ||
    args[2] !== "--output-directory" ||
    appRoot === undefined ||
    outputDirectory === undefined ||
    !isAbsolute(appRoot) ||
    !isAbsolute(outputDirectory)
  ) {
    throw new Error(
      "Expected absolute --app-root and --output-directory arguments"
    );
  }
  return { appRoot, outputDirectory };
};

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    if (args[0] === "--browser") {
      const options = parseCliArguments(args.slice(1));
      const fixture = await runMarketingPreferencesBrowserFixture(options);
      const result: BrowserSuccessMessage = {
        status: "ok",
        bunVersion: Bun.version,
        reportPath: fixture.reportPath,
        logPath: fixture.logPath,
      };
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else {
      const options = parseCliArguments(args);
      const fixture = await buildMarketingPreferencesFixture(options);
      const result: FixtureSuccessMessage = {
        status: "ok",
        bunVersion: Bun.version,
        cssPath: fixture.cssPath,
        entryPath: fixture.entryPath,
        javascriptPath: fixture.javascriptPath,
        scheduler: fixture.scheduler,
      };
      process.stdout.write(`${JSON.stringify(result)}\n`);
    }
  } catch (cause) {
    const result: FixtureErrorMessage = {
      status: "error",
      message: formatBuildDiagnostics(cause),
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = 1;
  }
}
