import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { Predicate, Schema } from "effect";

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
type FixtureSuccessMessage = Schema.Schema.Type<typeof fixtureSuccessSchema>;
type FixtureErrorMessage = Schema.Schema.Type<typeof fixtureErrorSchema>;
type FixtureMessage = FixtureSuccessMessage | FixtureErrorMessage;
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

const maxFixtureStdoutBytes = 64 * 1024;
const defaultFixtureTimeoutMs = 60_000;

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

export async function compileMarketingPreferencesFixture({
  appRoot,
  outputDirectory,
  timeoutMs,
}: MarketingPreferencesFixtureOptions & {
  readonly timeoutMs?: number;
}): Promise<MarketingPreferencesFixture> {
  const deadline = timeoutMs ?? defaultFixtureTimeoutMs;
  if (!Number.isFinite(deadline) || deadline < 0) {
    throw new Error("Marketing preferences fixture timeout is invalid");
  }

  let child: Bun.Subprocess;
  try {
    child = Bun.spawn(
      [
        process.execPath,
        "run",
        import.meta.path,
        "--app-root",
        appRoot,
        "--output-directory",
        outputDirectory,
      ],
      {
        cwd: appRoot,
        stderr: "ignore",
        stdin: "ignore",
        stdout: "pipe",
      }
    );
  } catch {
    throw new Error("Could not launch marketing preferences fixture child");
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
  const timer = setTimeout(() => {
    timedOut = true;
    void terminate();
  }, deadline);
  if (!(child.stdout instanceof ReadableStream)) {
    clearTimeout(timer);
    await terminate();
    throw new Error(
      "Marketing preferences fixture child stdout was unavailable"
    );
  }
  const stdoutPromise = readBoundedStdout(child.stdout).catch(async (error) => {
    await terminate();
    throw error;
  });
  const [stdoutResult, exitResult] = await Promise.allSettled([
    stdoutPromise,
    exitPromise,
  ]);
  clearTimeout(timer);

  if (timedOut) {
    throw new Error(
      `Marketing preferences fixture child timed out after ${deadline}ms`
    );
  }
  if (stdoutResult.status === "rejected") {
    throw new Error("Marketing preferences fixture child stdout failed");
  }
  if (exitResult.status === "rejected") {
    await terminate();
    throw new Error("Marketing preferences fixture child exit failed");
  }

  let message: FixtureMessage;
  try {
    message = parseFixtureMessage(stdoutResult.value);
  } catch (error) {
    if (exitResult.value !== 0) {
      throw new Error(
        `Marketing preferences fixture child exited with code ${exitResult.value}`
      );
    }
    throw error;
  }
  if (exitResult.value !== 0) {
    if (message.status === "error") {
      throw new Error(
        `Marketing preferences fixture child failed: ${message.message}`
      );
    }
    throw new Error(
      `Marketing preferences fixture child exited with code ${exitResult.value}`
    );
  }
  if (message.status === "error") {
    throw new Error(
      `Marketing preferences fixture child failed: ${message.message}`
    );
  }
  return validateFixtureSuccess(message, outputDirectory);
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
    const options = parseCliArguments(process.argv.slice(2));
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
  } catch (cause) {
    const result: FixtureErrorMessage = {
      status: "error",
      message: formatBuildDiagnostics(cause),
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = 1;
  }
}
