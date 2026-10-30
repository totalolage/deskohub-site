import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, Frame, Page } from "@playwright/test";
import { Effect, Exit, Scope } from "effect";
import { normalizePostgresConnectionUrl } from "../db/postgres-connection-url";
import { E2EBrowserSession } from "./browser-session";
import { runUntracedE2EEffect } from "./effect-edge";
import {
  toWorkspaceE2EError,
  type WorkspaceE2EError,
  workspaceE2EError,
  workspaceE2ETimeoutError,
} from "./errors";
import { redact } from "./redaction";
import { argvCommandTimeoutMs } from "./timeouts";

export {
  addDatabaseUrlRedactions,
  addRedaction,
  redact,
  redactDiagnosticText,
} from "./redaction";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const workspaceDir = resolve(scriptDir, "..");

type RunBrowserOptions = {
  allowFailure?: boolean;
  input?: string;
  logCommand?: boolean;
  logOutput?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
};

type BrowserCommandResult = {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
};

export type Runner = {
  (
    command: "playwright",
    args: string[],
    options?: RunBrowserOptions
  ): Promise<BrowserCommandResult>;
  readonly close?: () => Promise<void>;
  /**
   * The browser session behind an argv `--session` id, so a migrated helper
   * drives the same context as the argv commands around it.
   */
  readonly session?: (
    id: string
  ) => Effect.Effect<E2EBrowserSession, WorkspaceE2EError>;
};

/**
 * The browser session behind a runner's `--session` id, for helpers that
 * drive it directly while the argv commands around them still use the id.
 */
export const browserSessionFor = (
  run: Runner,
  id: string
): Effect.Effect<E2EBrowserSession, WorkspaceE2EError> =>
  run.session
    ? run.session(id)
    : Effect.fail(
        workspaceE2EError("This runner has no browser sessions", {
          operation: "open browser session",
        })
      );

/**
 * One argv session: the browser session plus the state only the argv
 * protocol needs, namely tab ids and the iframe that commands target. Any
 * change of the active page drops the selected iframe.
 */
type ArgvSession = {
  readonly browserSession: E2EBrowserSession;
  readonly scope: Scope.Closeable;
} & ArgvPageState;

type ArgvPageState = {
  frame?: Frame;
  readonly pageIds: Map<Page, string>;
};

type ArgvRunnerOptions = {
  /** Exchanges the preview bypass secret; see `E2EBrowserSession.open`. */
  readonly fetch?: typeof fetch;
  readonly recordHar?: boolean;
  /**
   * The caller's Scope, which then owns every session: closing it closes
   * them, a session whose opening outlives it closes as soon as it opens, and
   * `close` still closes them early.
   */
  readonly scope?: Scope.Scope;
};

/**
 * The argv browser protocol over `E2EBrowserSession`, kept until every
 * caller drives the session directly. Each `--session` id lazily opens one
 * session; `close` closes them all.
 */
export const makePlaywrightBrowserRunner = (
  browser: Browser,
  options: ArgvRunnerOptions = {}
): Runner => {
  const sessions = new Map<string, Promise<ArgvSession>>();
  const getSession = (id: string) => {
    const existing = sessions.get(id);
    if (existing) return existing;
    const created = openArgvSession(browser, id, options);
    sessions.set(id, created);
    return created;
  };

  const run = (async (
    command: "playwright",
    args: string[],
    options: RunBrowserOptions = {}
  ) => {
    const printable = redact([command, ...args].join(" "));
    if (options.logCommand !== false) log(`$ ${printable}`);

    try {
      const stdout = redact(
        await execute(
          getSession,
          args,
          options.input,
          options.timeoutMs,
          options.signal
        )
      );
      const result = { exitCode: 0, stderr: "", stdout } as const;
      if (options.logOutput !== false && result.stdout) log(result.stdout);
      return result;
    } catch (cause) {
      const stderr = redact(
        cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)
      );
      if (!options.allowFailure) {
        throw new Error(
          `${options.logCommand === false ? command : printable} failed\n${stderr}`.trim(),
          { cause }
        );
      }
      if (options.logOutput !== false && stderr) log(stderr);
      return { exitCode: 1, stderr, stdout: "" };
    }
  }) as Runner;
  Object.defineProperties(run, {
    close: {
      enumerable: true,
      value: async () => {
        const opened = await Promise.allSettled(sessions.values());
        await Promise.allSettled(
          opened.flatMap((entry) =>
            entry.status === "fulfilled"
              ? [
                  runUntracedE2EEffect(
                    Scope.close(entry.value.scope, Exit.void)
                  ),
                ]
              : []
          )
        );
      },
    },
    session: {
      enumerable: true,
      value: (id: string) =>
        Effect.tryPromise({
          catch: (cause) => toWorkspaceE2EError("open browser session", cause),
          try: () => getSession(id),
        }).pipe(Effect.map(({ browserSession }) => browserSession)),
    },
  });
  return run;
};

const openArgvSession = (
  browser: Browser,
  id: string,
  options: ArgvRunnerOptions
): Promise<ArgvSession> =>
  runUntracedE2EEffect(
    Effect.gen(function* () {
      const pageState: ArgvPageState = { pageIds: new Map() };
      const scope = yield* options.scope
        ? Scope.fork(options.scope)
        : Scope.make();
      const browserSession = yield* E2EBrowserSession.open({
        browser,
        fetch: options.fetch,
        id,
        onActivate: () => {
          pageState.frame = undefined;
        },
        recordHar: options.recordHar,
      }).pipe(
        Scope.provide(scope),
        Effect.onError((cause) => Scope.close(scope, Exit.failCause(cause)))
      );
      return Object.assign(pageState, { browserSession, scope });
    })
  );

const execute = (
  getSession: (id: string) => Promise<ArgvSession>,
  args: string[],
  input: string | undefined,
  timeoutMs = argvCommandTimeoutMs,
  signal?: AbortSignal
) => {
  const sessionId = args[0] === "--session" ? args[1] : undefined;
  if (!sessionId) throw new Error("Playwright session is required");
  const commandArgs = args.slice(2);

  return runUntracedE2EEffect(
    // A failed session opening rejects with its own cause.
    Effect.promise(() => getSession(sessionId)).pipe(
      Effect.flatMap((session) =>
        Effect.suspend(() => runCommand(session, commandArgs, input, timeoutMs))
      )
    ),
    { signal }
  );
};

const runCommand = (
  session: ArgvSession,
  args: string[],
  input: string | undefined,
  timeoutMs: number
): Effect.Effect<string, unknown> => {
  const { browserSession } = session;
  const { command, commandArgs, headers, json } = parseBrowserCommand(args);
  const frame = (page: Page) => session.frame ?? page.mainFrame();
  const actionLocator = (page: Page, selector: string) =>
    frame(page)
      .locator(toPlaywrightSelector(selector))
      .filter({ visible: true });
  const drive = <A>(
    label: string,
    operation: (page: Page) => Promise<A>,
    deadlineMs?: number
  ) => driveArgv(browserSession, label, operation, deadlineMs);
  const asDone = Effect.as("");

  switch (command) {
    case "open": {
      const url = requireArgument(commandArgs[0], "browser URL");
      const navigate = drive("open", async (page) => {
        await page.goto(url, { timeout: timeoutMs, waitUntil: "load" });
        session.frame = undefined;
        return page.url();
      });
      return headers
        ? browserSession
            .primePreviewAccess(url, readPreviewBypassSecret(headers), {
              timeoutMs,
            })
            .pipe(Effect.mapError(toArgvFailure), Effect.andThen(navigate))
        : navigate;
    }
    case "wait": {
      if (commandArgs[0] !== "--fn")
        throw new Error("Only Playwright function waits are supported");
      const condition = requireArgument(
        commandArgs[1],
        "browser wait condition"
      );
      return drive("wait", (page) =>
        frame(page).waitForFunction(condition, undefined, {
          timeout: timeoutMs,
        })
      ).pipe(asDone);
    }
    case "eval": {
      if (commandArgs[0] !== "--stdin" || input === undefined)
        throw new Error("Playwright evaluation input is required");
      return drive(
        "frame.evaluate",
        (page) => frame(page).evaluate(input),
        timeoutMs
      ).pipe(Effect.map(serializeBrowserValue));
    }
    case "fill": {
      const target = requireArgument(commandArgs[0], "fill target");
      const value = requireArgument(commandArgs[1], "fill value");
      return drive("fill", (page) =>
        actionLocator(page, target).fill(value, { timeout: timeoutMs })
      ).pipe(asDone);
    }
    case "type": {
      const target = requireArgument(commandArgs[0], "type target");
      const value = requireArgument(commandArgs[1], "type value");
      return drive("type", (page) =>
        actionLocator(page, target).pressSequentially(value, {
          delay: 50,
          timeout: timeoutMs,
        })
      ).pipe(asDone);
    }
    case "click": {
      const target = requireArgument(commandArgs[0], "click target");
      return drive("click", (page) =>
        actionLocator(page, target).click({ timeout: timeoutMs })
      ).pipe(asDone);
    }
    case "focus": {
      const target = requireArgument(commandArgs[0], "focus target");
      return drive("focus", (page) =>
        actionLocator(page, target).focus({ timeout: timeoutMs })
      ).pipe(asDone);
    }
    case "press": {
      const key = requireArgument(commandArgs[0], "keyboard key");
      return drive("press", (page) => page.keyboard.press(key)).pipe(asDone);
    }
    case "snapshot":
      return drive("snapshot", async (page) => {
        const body = frame(page).locator("body");
        await body.waitFor({ state: "attached", timeout: timeoutMs });
        return body.ariaSnapshot({ mode: "ai", timeout: timeoutMs });
      });
    case "screenshot": {
      const path = requireArgument(commandArgs[0], "screenshot path");
      assert(path.length > 0, "screenshot path is required");
      return drive("screenshot", (page) =>
        page.screenshot({
          animations: "disabled",
          fullPage: true,
          path,
          timeout: timeoutMs,
        })
      ).pipe(asDone);
    }
    case "get":
      if (commandArgs[0] === "url")
        return drive("get url", async (page) => page.url());
      if (commandArgs[0] === "value") {
        const target = requireArgument(commandArgs[1], "value target");
        return drive("get value", (page) =>
          actionLocator(page, target).inputValue({ timeout: timeoutMs })
        );
      }
      throw new Error(
        `Unsupported Playwright get operation: ${commandArgs[0]}`
      );
    case "tab": {
      if (commandArgs[0] === "list")
        return drive("tab list", async (page) => {
          const tabs = page.context().pages();
          return serializeBrowserValue({
            data: {
              tabs: tabs.map((tab) => ({
                active: tab === page,
                tabId: requirePageId(session, tabs, tab),
              })),
            },
            success: true,
          });
        });
      const closing = commandArgs[0] === "close";
      const tabId = requireArgument(
        commandArgs[closing ? 1 : 0],
        "browser tab id"
      );
      return drive("tab", async (page) => {
        const tabs = page.context().pages();
        for (const tab of tabs) requirePageId(session, tabs, tab);
        const target = [...session.pageIds].find(([, id]) => id === tabId)?.[0];
        if (!target || target.isClosed())
          throw new Error(`Playwright tab ${tabId} is unavailable`);
        if (closing) await target.close();
        return target;
      }).pipe(
        Effect.flatMap((target) =>
          closing
            ? Effect.void
            : browserSession
                .activate(target)
                .pipe(Effect.mapError(toArgvFailure))
        ),
        asDone
      );
    }
    case "frame": {
      const target = requireArgument(commandArgs[0], "browser frame");
      return drive("frame", async (page) => {
        if (target === "main") {
          session.frame = undefined;
          return "";
        }
        const handle = await actionLocator(page, target).elementHandle({
          timeout: timeoutMs,
        });
        const contentFrame = await handle?.contentFrame();
        if (!contentFrame)
          throw new Error("Playwright frame target unavailable");
        session.frame = contentFrame;
        return "";
      });
    }
    case "network":
      if (commandArgs[0] === "requests" && commandArgs.length === 1)
        return browserSession.diagnostics.pipe(
          Effect.map(({ requests }) => requests.join("\n"))
        );
      throw new Error(
        `Unsupported Playwright network operation: ${commandArgs.join(" ")}`
      );
    case "close":
      // The close runs on detached, so a timeout stops only this wait.
      return browserSession.close().pipe(
        Effect.timeoutOrElse({
          duration: `${timeoutMs} millis`,
          orElse: () =>
            Effect.fail(
              workspaceE2ETimeoutError(
                `close: Timeout ${timeoutMs}ms exceeded.`,
                {
                  operation: "close",
                }
              )
            ),
        }),
        Effect.mapError(toArgvFailure),
        asDone
      );
    default:
      throw new Error(
        `Unsupported Playwright browser operation: ${json ? "--json " : ""}${command} ${commandArgs.join(" ")}`.trim()
      );
  }
};

/**
 * Drives the active page and fails with Playwright's own error, which the
 * argv protocol reports verbatim. `deadlineMs` bounds work Playwright does
 * not, such as an evaluation; exceeding it fails as Playwright's own
 * timeouts read.
 */
const driveArgv = <A>(
  browserSession: E2EBrowserSession,
  label: string,
  operation: (page: Page) => Promise<A>,
  deadlineMs: number | undefined
): Effect.Effect<A, unknown> => {
  let failure: { readonly cause: unknown } | undefined;
  return browserSession
    .use(
      label,
      (page) =>
        operation(page).catch((cause: unknown) => {
          failure = { cause };
          throw cause;
        }),
      { timeoutMs: deadlineMs }
    )
    .pipe(
      Effect.mapError((error) => {
        if (failure) return failure.cause;
        return deadlineMs !== undefined && error.reason === "timeout"
          ? new Error(`${label}: Timeout ${deadlineMs}ms exceeded.`)
          : toArgvFailure(error);
      })
    );
};

// Keeps a session failure classified as it was when Playwright raised it:
// browser.ts treats only a `TimeoutError` as a timeout.
const toArgvFailure = (error: WorkspaceE2EError) => {
  const failure = new Error(error.message);
  if (error.reason === "timeout") failure.name = "TimeoutError";
  return failure;
};

const requirePageId = (
  session: ArgvSession,
  tabs: readonly Page[],
  page: Page
) => {
  for (const tab of tabs) {
    if (!session.pageIds.has(tab))
      session.pageIds.set(tab, `t${session.pageIds.size + 1}`);
  }
  const pageId = session.pageIds.get(page);
  if (!pageId) throw new Error("Playwright tab is unavailable");
  return pageId;
};

const parseBrowserCommand = (args: string[]) => {
  let cursor = 0;
  let headers: Record<string, string> | undefined;
  let json = false;
  while (args[cursor]?.startsWith("--")) {
    if (args[cursor] === "--headers") {
      headers = JSON.parse(
        requireArgument(args[cursor + 1], "browser request headers")
      ) as Record<string, string>;
      cursor += 2;
      continue;
    }
    if (args[cursor] === "--json") {
      json = true;
      cursor += 1;
      continue;
    }
    break;
  }
  return {
    command: requireArgument(args[cursor], "browser command"),
    commandArgs: args.slice(cursor + 1),
    headers,
    json,
  };
};

const previewBypassHeaders = new Set([
  "x-vercel-protection-bypass",
  "x-vercel-set-bypass-cookie",
]);

/**
 * `--headers` is the argv form of the preview bypass secret: the session
 * exchanges the secret itself, so a header it would not send is refused.
 */
const readPreviewBypassSecret = (headers: Record<string, string>) => {
  let secret: string | undefined;
  for (const [name, value] of Object.entries(headers)) {
    const header = name.toLowerCase();
    if (!previewBypassHeaders.has(header))
      throw new Error("Only the preview bypass headers are supported");
    if (header === "x-vercel-protection-bypass") secret = value;
  }
  return secret;
};

const toPlaywrightSelector = (selector: string) =>
  selector.startsWith("@") ? `aria-ref=${selector.slice(1)}` : selector;

const serializeBrowserValue = (value: unknown) => {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  return JSON.stringify(value);
};

const requireArgument = (value: string | undefined, label: string) => {
  if (value === undefined) throw new Error(`${label} is required`);
  return value;
};

export const assertSafeDatabaseUrl = (
  databaseUrl: string,
  label: string,
  databaseAllowlist: string
) => {
  const allowlist = databaseAllowlist
    .split(",")
    .map((value) => value.trim())
    .map(databaseAllowlistKey)
    .filter(Boolean);
  assert(
    allowlist.includes(databaseSafetyKey(databaseUrl)),
    `${label} is not allowlisted for workspace e2e`
  );
};

const databaseSafetyKey = (databaseUrl: string) => {
  const url = new URL(normalizePostgresConnectionUrl(databaseUrl));
  return databaseKeyFromHostPath(url.hostname, url.pathname);
};

const databaseAllowlistKey = (value: string) => {
  if (!value) return value;
  if (value.includes("://")) return databaseSafetyKey(value);
  const slashIndex = value.indexOf("/");
  if (slashIndex === -1) return databaseKeyFromHostPath(value, "");
  return databaseKeyFromHostPath(
    value.slice(0, slashIndex),
    value.slice(slashIndex)
  );
};

const databaseKeyFromHostPath = (hostname: string, pathname: string) => {
  const [firstLabel, ...rest] = hostname.split(".");
  const normalizedFirstLabel =
    hostname.endsWith(".neon.tech") && firstLabel?.endsWith("-pooler")
      ? firstLabel.slice(0, -"-pooler".length)
      : firstLabel;
  return `${[normalizedFirstLabel, ...rest].join(".")}${pathname}`;
};

export const parseUrl = (value: string) => {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
};

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export const log = (message: string) =>
  process.stdout.write(`${redact(message)}\n`);

export const writeJsonAtomically = async (path: string, value: unknown) => {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, path);
};
