import { copyFile, rm } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Browser,
  BrowserContext,
  ConsoleMessage,
  Frame,
  Page,
  Request,
  Response,
} from "@playwright/test";
import { normalizePostgresConnectionUrl } from "../db/postgres-connection-url";

export const scriptDir = dirname(fileURLToPath(import.meta.url));
export const workspaceDir = resolve(scriptDir, "..");
export const repoRoot = resolve(workspaceDir, "../..");
const redactions = new Set<string>();

export type RunBrowserOptions = {
  allowFailure?: boolean;
  input?: string;
  logCommand?: boolean;
  logOutput?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type BrowserCommandResult = {
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
};

type PlaywrightSession = {
  closePromise?: Promise<void>;
  readonly consoleMessages: string[];
  readonly context: BrowserContext;
  currentFrame: Frame;
  currentPage: Page;
  readonly errors: string[];
  harStarted: boolean;
  readonly networkRequests: string[];
  readonly pageIds: Map<Page, string>;
  readonly primedOrigins: Set<string>;
  rawHarPath?: string;
};

const maximumDiagnosticEntries = 500;

export const makePlaywrightBrowserRunner = (
  browser: Browser,
  options: { readonly recordHar?: boolean } = {}
): Runner =>
  makePlaywrightRuntimeRunner(new PlaywrightRuntime(browser, options));

const makePlaywrightRuntimeRunner = (runtime: PlaywrightRuntime): Runner => {
  const run = (async (
    command: "playwright",
    args: string[],
    options: RunBrowserOptions = {}
  ) => {
    const printable = redact([command, ...args].join(" "));
    if (options.logCommand !== false) log(`$ ${printable}`);

    try {
      const stdout = redact(
        await runtime.execute(
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
  Object.defineProperty(run, "close", {
    enumerable: true,
    value: () => runtime.close(),
  });
  return run;
};

class PlaywrightRuntime {
  private readonly sessionPromises = new Map<
    string,
    Promise<PlaywrightSession>
  >();

  constructor(
    private readonly browser: Browser,
    private readonly options: { readonly recordHar?: boolean } = {}
  ) {}

  async execute(
    args: string[],
    input: string | undefined,
    timeoutMs = 120_000,
    signal?: AbortSignal
  ) {
    const sessionId = args[0] === "--session" ? args[1] : undefined;
    if (!sessionId) throw new Error("Playwright session is required");
    const commandArgs = args.slice(2);

    return this.interruptible(signal, async () => {
      const session = await this.getSession(sessionId);
      return this.runCommand(session, commandArgs, input, timeoutMs);
    });
  }

  async close() {
    const sessions = await Promise.allSettled(this.sessionPromises.values());
    await Promise.allSettled(
      sessions.flatMap((entry) =>
        entry.status === "fulfilled" ? [this.finalizeSession(entry.value)] : []
      )
    );
  }

  private async runCommand(
    session: PlaywrightSession,
    args: string[],
    input: string | undefined,
    timeoutMs: number
  ): Promise<string> {
    const { command, commandArgs, headers, json } = parseBrowserCommand(args);
    const page = () => session.currentPage;
    const frame = () => session.currentFrame;
    const locator = (selector: string) =>
      frame().locator(toPlaywrightSelector(selector));
    const actionLocator = (selector: string) =>
      locator(selector).filter({ visible: true });

    switch (command) {
      case "open": {
        const url = requireArgument(commandArgs[0], "browser URL");
        if (headers) await primePreviewAccess(session, url, headers, timeoutMs);
        await page().goto(url, { timeout: timeoutMs, waitUntil: "load" });
        session.currentFrame = page().mainFrame();
        return page().url();
      }
      case "wait": {
        if (commandArgs[0] !== "--fn")
          throw new Error("Only Playwright function waits are supported");
        await frame().waitForFunction(
          requireArgument(commandArgs[1], "browser wait condition"),
          undefined,
          { timeout: timeoutMs }
        );
        return "";
      }
      case "eval": {
        if (commandArgs[0] !== "--stdin" || input === undefined)
          throw new Error("Playwright evaluation input is required");
        const value = await frame().evaluate(input);
        return serializeBrowserValue(value);
      }
      case "fill":
        await actionLocator(
          requireArgument(commandArgs[0], "fill target")
        ).fill(requireArgument(commandArgs[1], "fill value"), {
          timeout: timeoutMs,
        });
        return "";
      case "type":
        await actionLocator(
          requireArgument(commandArgs[0], "type target")
        ).pressSequentially(requireArgument(commandArgs[1], "type value"), {
          delay: 50,
          timeout: timeoutMs,
        });
        return "";
      case "click":
        await actionLocator(
          requireArgument(commandArgs[0], "click target")
        ).click({ timeout: timeoutMs });
        return "";
      case "focus":
        await actionLocator(
          requireArgument(commandArgs[0], "focus target")
        ).focus({ timeout: timeoutMs });
        return "";
      case "press":
        await page().keyboard.press(
          requireArgument(commandArgs[0], "keyboard key")
        );
        return "";
      case "snapshot": {
        const body = frame().locator("body");
        await body.waitFor({ state: "attached", timeout: timeoutMs });
        return body.ariaSnapshot({
          mode: "ai",
          timeout: timeoutMs,
        });
      }
      case "get":
        if (commandArgs[0] === "url") return page().url();
        if (commandArgs[0] === "value")
          return actionLocator(
            requireArgument(commandArgs[1], "value target")
          ).inputValue({ timeout: timeoutMs });
        throw new Error(
          `Unsupported Playwright get operation: ${commandArgs[0]}`
        );
      case "tab": {
        if (commandArgs[0] === "list")
          return serializeBrowserValue({
            data: {
              tabs: session.context.pages().map((tab) => ({
                active: tab === session.currentPage,
                tabId: requirePageId(session, tab),
              })),
            },
            success: true,
          });
        const tabId = requireArgument(commandArgs[0], "browser tab id");
        const target = [...session.pageIds].find(([, id]) => id === tabId)?.[0];
        if (!target || target.isClosed())
          throw new Error(`Playwright tab ${tabId} is unavailable`);
        session.currentPage = target;
        session.currentFrame = target.mainFrame();
        await target.bringToFront();
        return "";
      }
      case "frame": {
        const target = requireArgument(commandArgs[0], "browser frame");
        if (target === "main") {
          session.currentFrame = page().mainFrame();
          return "";
        }
        const handle = await actionLocator(target).elementHandle({
          timeout: timeoutMs,
        });
        const contentFrame = await handle?.contentFrame();
        if (!contentFrame)
          throw new Error("Playwright frame target unavailable");
        session.currentFrame = contentFrame;
        return "";
      }
      case "console":
        if (commandArgs[0] === "--clear") {
          session.consoleMessages.length = 0;
          return "";
        }
        return session.consoleMessages.join("\n");
      case "errors":
        if (commandArgs[0] === "--clear") {
          session.errors.length = 0;
          return "";
        }
        return session.errors.join("\n\n");
      case "network":
        if (commandArgs[0] === "requests") {
          if (commandArgs[1] === "--clear") {
            session.networkRequests.length = 0;
            return "";
          }
          return session.networkRequests.join("\n");
        }
        if (commandArgs[0] === "har" && commandArgs[1] === "start") {
          session.harStarted = true;
          return "";
        }
        if (commandArgs[0] === "har" && commandArgs[1] === "stop") {
          await this.closeSession(session);
          const destination = commandArgs[2];
          if (session.rawHarPath) {
            if (destination && destination !== devNull)
              await copyFile(session.rawHarPath, destination);
            await rm(session.rawHarPath, { force: true });
          }
          return "";
        }
        throw new Error(
          `Unsupported Playwright network operation: ${commandArgs.join(" ")}`
        );
      case "close":
        await this.closeSession(session);
        if (session.rawHarPath) await rm(session.rawHarPath, { force: true });
        return "";
      default:
        throw new Error(
          `Unsupported Playwright browser operation: ${json ? "--json " : ""}${command} ${commandArgs.join(" ")}`.trim()
        );
    }
  }

  private async getSession(sessionId: string) {
    const existing = this.sessionPromises.get(sessionId);
    if (existing) return existing;

    const created = this.createSession(sessionId);
    this.sessionPromises.set(sessionId, created);
    return created;
  }

  private async createSession(sessionId: string): Promise<PlaywrightSession> {
    const recordHar = this.options.recordHar !== false;
    const rawHarPath = recordHar
      ? resolve(
          tmpdir(),
          `${sessionId.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}-${crypto.randomUUID()}.har`
        )
      : undefined;
    let context: BrowserContext | undefined;
    try {
      context = await this.browser.newContext({
        recordHar: rawHarPath
          ? { content: "embed", mode: "full", path: rawHarPath }
          : undefined,
        viewport: { height: 900, width: 1440 },
      });
      const initialPage = await context.newPage();
      const session = {
        closePromise: undefined,
        consoleMessages: [],
        context,
        currentFrame: initialPage.mainFrame(),
        currentPage: initialPage,
        errors: [],
        harStarted: false,
        networkRequests: [],
        pageIds: new Map<Page, string>(),
        primedOrigins: new Set<string>(),
        rawHarPath,
      } satisfies PlaywrightSession;
      context.on("page", (page) => registerPage(session, page, true));
      registerPage(session, initialPage, true);
      return session;
    } catch (cause) {
      await context?.close().catch(() => undefined);
      if (rawHarPath) await rm(rawHarPath, { force: true });
      throw cause;
    }
  }

  private async finalizeSession(session: PlaywrightSession) {
    try {
      await this.closeSession(session);
    } finally {
      if (session.rawHarPath) await rm(session.rawHarPath, { force: true });
    }
  }

  private async closeSession(session: PlaywrightSession) {
    session.closePromise ??= session.context.close({
      reason: "Workspace E2E case complete",
    });
    await session.closePromise;
  }

  private async interruptible<A>(
    signal: AbortSignal | undefined,
    operation: () => Promise<A>
  ): Promise<A> {
    if (!signal) return operation();
    if (signal.aborted) throw signal.reason;

    return new Promise<A>((resolvePromise, rejectPromise) => {
      const abort = () => {
        // The case finalizer closes the context. Genuine failures capture their
        // diagnostics first; interrupted siblings enter that finalizer directly.
        rejectPromise(
          signal.reason ?? new DOMException("Aborted", "AbortError")
        );
      };
      signal.addEventListener("abort", abort, { once: true });
      operation()
        .then(resolvePromise, rejectPromise)
        .finally(() => signal.removeEventListener("abort", abort));
    });
  }
}

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

const primePreviewAccess = async (
  session: PlaywrightSession,
  target: string,
  headers: Record<string, string>,
  timeoutMs: number
) => {
  const origin = new URL(target).origin;
  if (session.primedOrigins.has(origin)) return;
  const response = await session.context.request.get(
    new URL("/favicon.svg", origin).toString(),
    { headers, timeout: timeoutMs }
  );
  try {
    if (!response.ok())
      throw new Error(
        `Playwright preview bypass probe failed with ${response.status()}`
      );
    session.primedOrigins.add(origin);
  } finally {
    await response.dispose();
  }
};

const registerPage = (
  session: PlaywrightSession,
  page: Page,
  makeCurrent: boolean
) => {
  const alreadyRegistered = session.pageIds.has(page);
  requirePageId(session, page);
  if (makeCurrent) {
    session.currentPage = page;
    session.currentFrame = page.mainFrame();
  }
  if (alreadyRegistered) return;
  page.on("console", (message) =>
    pushDiagnostic(session.consoleMessages, formatConsoleMessage(message))
  );
  page.on("pageerror", (error) =>
    pushDiagnostic(session.errors, error.stack ?? error.message)
  );
  page.on("close", () => {
    if (session.currentPage !== page) return;
    const replacement = session.context
      .pages()
      .findLast((candidate) => !candidate.isClosed());
    if (!replacement) return;
    session.currentPage = replacement;
    session.currentFrame = replacement.mainFrame();
  });
  page.on("request", (request) =>
    pushDiagnostic(session.networkRequests, formatRequest(request))
  );
  page.on("response", (response) =>
    pushDiagnostic(session.networkRequests, formatResponse(response))
  );
  page.on("requestfailed", (request) =>
    pushDiagnostic(
      session.networkRequests,
      `${formatRequest(request)} failed: ${request.failure()?.errorText ?? "unknown"}`
    )
  );
};

const requirePageId = (session: PlaywrightSession, page: Page) => {
  const existing = session.pageIds.get(page);
  if (existing) return existing;
  const pageId = `t${session.pageIds.size + 1}`;
  session.pageIds.set(page, pageId);
  return pageId;
};

const pushDiagnostic = (entries: string[], value: string) => {
  entries.push(value);
  if (entries.length > maximumDiagnosticEntries)
    entries.splice(0, entries.length - maximumDiagnosticEntries);
};

const formatConsoleMessage = (message: ConsoleMessage) =>
  `[${message.type()}] ${message.text()}`;

const formatRequest = (request: Request) =>
  `${request.method()} ${request.url()}`;

const formatResponse = (response: Response) =>
  `${response.status()} ${response.request().method()} ${response.url()}`;

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

export const addRedaction = (value: string | undefined, force = false) => {
  if (!value || (!force && value.length <= 6)) return;
  redactions.add(value);
  redactions.add(encodeURIComponent(value));
  redactions.add(
    new URLSearchParams({ value }).toString().slice("value=".length)
  );
};

export const addDatabaseUrlRedactions = (value: string | undefined) => {
  addRedaction(value);
  if (!value) return;

  const url = parseUrl(value);
  if (!url) return;
  [
    url.host,
    url.hostname,
    url.pathname,
    url.pathname.slice(1),
    url.username,
    url.password,
  ].forEach((part) => {
    addRedaction(part, true);
  });
};

export const redact = (text: string) => {
  let output = text;
  for (const secret of redactions)
    output = output.replaceAll(secret, "[redacted]");
  return output;
};

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export const log = (message: string) =>
  process.stdout.write(`${redact(message)}\n`);
