import { AssertionError } from "node:assert";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type {
  Browser,
  BrowserContext,
  ConsoleMessage,
  Page,
  Request,
  Response,
} from "@playwright/test";
import { Deferred, Effect, type Scope } from "effect";
import {
  formatNexiBuildFailureLine,
  isNexiBuildApiUrl,
  listNexiBuildFailureCodes,
  summarizeNexiBuildFailureBody,
  toNexiBuildEndpoint,
} from "./checkout/nexi-build-api";
import {
  WorkspaceE2EError,
  workspaceE2EError,
  workspaceE2ETimeoutError,
} from "./errors";
import { withinWorkspaceE2EDeadline } from "./polling";
import { redact, redactJsonValue } from "./redaction";

/** What the session captured from every page of its context, redacted. */
type E2EBrowserDiagnostics = {
  readonly console: readonly string[];
  readonly errors: readonly string[];
  readonly requests: readonly string[];
};

/** A signed session cookie for one HTTPS origin; its value is never logged. */
type E2EBrowserSessionCookie = {
  readonly name: string;
  readonly url: string;
  readonly value: string;
};

type E2EBrowserDeadline = {
  /**
   * Bounds the whole callback. Playwright actions keep their own `timeout`
   * option; pass this for work Playwright does not bound, such as
   * `page.evaluate`.
   */
  readonly timeoutMs?: number;
};

/**
 * One E2E case's browser: an isolated Playwright context bound to a Scope.
 *
 * Drive it with native Playwright through `use` and `evaluate`. The session
 * owns what Playwright does not: the context lifecycle, the HAR (closed,
 * sanitized, and only then handed out), capped console, error, and network
 * capture across every page, preview bypass priming, redaction, and failure
 * classification.
 *
 * `use` drives the active page. A page the app opens becomes active; closing
 * the active page falls back to the newest page still open; `activate`
 * switches explicitly.
 *
 * Failures are `WorkspaceE2EError`s that name only the label and the
 * failure's class, never Playwright's message or cause, which can embed
 * headers, cookies, the bypass secret, and URLs. A Playwright timeout or an
 * exceeded `timeoutMs` is a timeout; a failure after the session started
 * closing reports the closed session; an `AssertionError` keeps its
 * code-owned message; a `WorkspaceE2EError` from the callback passes through.
 * Interrupting a call only stops waiting; the browser work stops when the
 * Scope, which the caller keeps open through failure capture, closes the
 * context.
 */
export type E2EBrowserSession = {
  readonly activate: (page: Page) => Effect.Effect<void, WorkspaceE2EError>;
  readonly clearDiagnostics: (
    kind: keyof E2EBrowserDiagnostics
  ) => Effect.Effect<void>;
  /**
   * Closes the context so Playwright flushes its HAR, writes the sanitized
   * HAR to `harPath` when one was recorded, and deletes the raw file even
   * when the export fails. The first call decides the export and cannot be
   * interrupted; later calls wait for it and share its outcome, and fail when
   * they ask for a HAR the first call did not write. The Scope finalizer
   * closes the context and deletes the raw file too.
   */
  readonly close: (options?: {
    readonly harPath?: string;
  }) => Effect.Effect<void, WorkspaceE2EError>;
  readonly diagnostics: Effect.Effect<E2EBrowserDiagnostics>;
  /**
   * Evaluates `fn` in the active page. Playwright serializes `fn`, so it must
   * not close over anything; pass everything it needs through `arg`.
   */
  readonly evaluate: <A, Arg>(
    label: string,
    fn: (arg: Arg) => A | Promise<A>,
    arg: Arg,
    options?: E2EBrowserDeadline
  ) => Effect.Effect<A, WorkspaceE2EError>;
  /**
   * Probes the origin's favicon with the caller's request headers, intact,
   * once per origin, so Vercel can answer with its bypass cookie. A rejected
   * probe fails and leaves the origin unprimed.
   */
  readonly primePreviewAccess: (
    url: string,
    headers: Readonly<Record<string, string>>,
    options: { readonly timeoutMs: number }
  ) => Effect.Effect<void, WorkspaceE2EError>;
  /** Adds an HTTP-only, Secure, Lax cookie bound to one HTTPS origin. */
  readonly setSessionCookie: (
    cookie: E2EBrowserSessionCookie
  ) => Effect.Effect<void, WorkspaceE2EError>;
  readonly use: <A>(
    label: string,
    drive: (page: Page) => Promise<A>,
    options?: E2EBrowserDeadline
  ) => Effect.Effect<A, WorkspaceE2EError>;
};

type SessionState = {
  active: Page;
  readonly onActivate?: (page: Page) => void;
  readonly diagnostics: {
    readonly console: string[];
    readonly errors: string[];
    readonly requests: string[];
  };
  readonly primedOrigins: Set<string>;
  readonly registeredPages: WeakSet<Page>;
};

const maximumDiagnosticEntries = 500;

const open = Effect.fn("E2EBrowserSession.open")(function* (options: {
  readonly browser: Browser;
  /** Names the raw HAR file; any characters are safe. */
  readonly id: string;
  /**
   * Hears every change of the active page. Only the argv runner uses it, to
   * drop its selected iframe.
   */
  readonly onActivate?: (page: Page) => void;
  /** Records a HAR for `close({ harPath })`; on by default. */
  readonly recordHar?: boolean;
}): Effect.fn.Return<E2EBrowserSession, WorkspaceE2EError, Scope.Scope> {
  const rawHarPath =
    options.recordHar === false
      ? undefined
      : resolve(
          tmpdir(),
          `${options.id.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}-${crypto.randomUUID()}.har`
        );
  // Registered first so it runs last: Playwright writes the HAR on close.
  if (rawHarPath) yield* Effect.addFinalizer(() => removeFile(rawHarPath));

  let closing: Promise<void> | undefined;
  const closeContextOf = (context: BrowserContext) => {
    closing ??= context.close({ reason: "Workspace E2E case complete" });
    return closing;
  };
  // Acquired uninterruptibly, so a context created while the caller was
  // interrupted still gets its release.
  const context = yield* Effect.acquireRelease(
    Effect.tryPromise({
      catch: (cause) => toSessionFailure("open the browser context", cause),
      try: () =>
        options.browser.newContext({
          recordHar: rawHarPath
            ? { content: "embed", mode: "full", path: rawHarPath }
            : undefined,
          viewport: { height: 900, width: 1440 },
        }),
    }),
    (context) =>
      Effect.tryPromise(() => closeContextOf(context)).pipe(Effect.ignore)
  );
  const closeContext = () => closeContextOf(context);

  const initialPage = yield* Effect.tryPromise({
    catch: (cause) => toSessionFailure("open the browser page", cause),
    try: () => context.newPage(),
  });
  const state: SessionState = {
    active: initialPage,
    onActivate: options.onActivate,
    diagnostics: { console: [], errors: [], requests: [] },
    primedOrigins: new Set(),
    registeredPages: new WeakSet(),
  };
  context.on("page", (page) => registerPage(state, context, page));
  registerPage(state, context, initialPage);

  const isClosing = () => closing !== undefined;

  const use = <A>(
    label: string,
    drive: (page: Page) => Promise<A>,
    deadline: E2EBrowserDeadline = {}
  ) => {
    const attempt = Effect.tryPromise({
      catch: (cause) => toSessionFailure(label, cause, isClosing()),
      try: () => drive(state.active),
    });
    return deadline.timeoutMs === undefined
      ? attempt
      : withinWorkspaceE2EDeadline(attempt, label, deadline.timeoutMs);
  };

  const closeAndExport = Effect.fn("E2EBrowserSession.close")(
    function* (harPath: string | undefined) {
      yield* Effect.tryPromise({
        catch: (cause) => toSessionFailure("close the browser context", cause),
        try: closeContext,
      });
      if (!(rawHarPath && harPath)) return;
      const har = yield* Effect.tryPromise({
        catch: (cause) => toSessionFailure("read the browser HAR", cause),
        try: () => readFile(rawHarPath, "utf8"),
      });
      yield* Effect.tryPromise({
        catch: (cause) => toSessionFailure("write the browser HAR", cause),
        try: () => writeFile(harPath, sanitizeHarArtifact(har)),
      });
    },
    (effect) =>
      rawHarPath ? Effect.ensuring(effect, removeFile(rawHarPath)) : effect
  );

  // The first close runs detached, so an interrupted or timed-out caller
  // stops only its own wait; every caller, the Scope finalizer included,
  // shares its outcome.
  const closed = yield* Deferred.make<void, WorkspaceE2EError>();
  let closeRequest: { readonly harPath?: string } | undefined;
  const startClose = (harPath: string | undefined) =>
    Effect.uninterruptible(
      Effect.suspend(() => {
        if (closeRequest) return Effect.succeed(closeRequest.harPath);
        closeRequest = { harPath };
        return Effect.forkDetach(
          closeAndExport(harPath).pipe(
            Effect.onExit((exit) => Deferred.done(closed, exit))
          )
        ).pipe(Effect.as(harPath));
      })
    );
  const close = ({ harPath }: { readonly harPath?: string } = {}) =>
    startClose(harPath).pipe(
      Effect.flatMap((exportedTo) =>
        Deferred.await(closed).pipe(
          Effect.andThen(
            harPath === undefined || harPath === exportedTo
              ? Effect.void
              : Effect.fail(
                  workspaceE2EError(
                    "The browser session already closed without this HAR",
                    { operation: "close the browser context" }
                  )
                )
          )
        )
      )
    );
  yield* Effect.addFinalizer(() => close().pipe(Effect.ignore));

  return {
    activate: (page) =>
      Effect.suspend(() => {
        if (page.isClosed())
          return Effect.fail(
            workspaceE2EError("A closed browser page cannot become active", {
              operation: "activate a browser page",
            })
          );
        setActive(state, page);
        return Effect.tryPromise({
          catch: (cause) =>
            toSessionFailure("activate a browser page", cause, isClosing()),
          try: () => page.bringToFront(),
        });
      }),
    clearDiagnostics: (kind) =>
      Effect.sync(() => {
        state.diagnostics[kind].length = 0;
      }),
    close,
    diagnostics: Effect.sync(() => ({
      console: state.diagnostics.console.map(redact),
      errors: state.diagnostics.errors.map(redact),
      requests: state.diagnostics.requests.map(redact),
    })),
    evaluate: <A, Arg>(
      label: string,
      fn: (arg: Arg) => A | Promise<A>,
      arg: Arg,
      deadline?: E2EBrowserDeadline
    ) =>
      use(
        label,
        // Playwright types the argument as its serialized form; plain data is
        // the same shape.
        (page) => page.evaluate(fn as (arg: unknown) => A | Promise<A>, arg),
        deadline
      ),
    primePreviewAccess: (url, headers, { timeoutMs }) =>
      Effect.suspend(() => {
        const origin = URL.parse(url)?.origin;
        if (!origin)
          return Effect.fail(
            workspaceE2EError("Preview access needs an absolute URL", {
              operation: "prime preview access",
            })
          );
        if (state.primedOrigins.has(origin)) return Effect.void;
        return Effect.tryPromise({
          catch: (cause) =>
            toSessionFailure("prime preview access", cause, isClosing()),
          // The wait stays interruptible; a probe answered after an
          // interruption still has its response disposed.
          try: (signal) => {
            const probe = context.request.get(
              new URL("/favicon.svg", origin).toString(),
              {
                headers,
                maxRedirects: 3,
                timeout: timeoutMs,
              }
            );
            signal.addEventListener(
              "abort",
              () => {
                probe.then(
                  (response) => response.dispose(),
                  () => undefined
                );
              },
              { once: true }
            );
            return probe;
          },
        }).pipe(
          Effect.flatMap((response) =>
            (response.ok()
              ? Effect.sync(() => {
                  state.primedOrigins.add(origin);
                })
              : Effect.fail(
                  workspaceE2EError(
                    `Preview bypass probe failed with ${response.status()}`,
                    { operation: "prime preview access" }
                  )
                )
            ).pipe(
              Effect.ensuring(
                Effect.tryPromise(() => response.dispose()).pipe(Effect.ignore)
              )
            )
          )
        );
      }),
    setSessionCookie: (cookie) =>
      Effect.suspend(() => {
        const url = URL.parse(cookie.url);
        if (
          !cookie.name ||
          !cookie.value ||
          url?.protocol !== "https:" ||
          url.pathname !== "/" ||
          url.search
        )
          return Effect.fail(
            workspaceE2EError(
              "Session cookies need a name, a value, and an HTTPS origin",
              { operation: "set the session cookie" }
            )
          );
        return Effect.tryPromise({
          catch: (cause) =>
            toSessionFailure("set the session cookie", cause, isClosing()),
          try: () =>
            context.addCookies([
              {
                httpOnly: true,
                name: cookie.name,
                sameSite: "Lax",
                secure: true,
                url: url.origin,
                value: cookie.value,
              },
            ]),
        });
      }),
    use,
  };
});

export const E2EBrowserSession = { open };

const removeFile = (path: string) =>
  Effect.tryPromise(() => rm(path, { force: true })).pipe(Effect.ignore);

const registerPage = (
  state: SessionState,
  context: BrowserContext,
  page: Page
) => {
  setActive(state, page);
  if (state.registeredPages.has(page)) return;
  state.registeredPages.add(page);
  const { diagnostics } = state;
  page.on("console", (message) =>
    pushDiagnostic(diagnostics.console, formatConsoleMessage(message))
  );
  page.on("pageerror", (error) =>
    pushDiagnostic(diagnostics.errors, error.stack ?? error.message)
  );
  page.on("close", () => {
    if (state.active !== page) return;
    const replacement = context
      .pages()
      .findLast((candidate) => !candidate.isClosed());
    if (replacement) setActive(state, replacement);
  });
  page.on("request", (request) =>
    pushDiagnostic(diagnostics.requests, formatRequest(request))
  );
  page.on("response", (response) => {
    pushDiagnostic(diagnostics.requests, formatResponse(response));
    recordNexiBuildFailure(diagnostics.requests, response);
  });
  page.on("requestfailed", (request) =>
    pushDiagnostic(
      diagnostics.requests,
      `${formatRequest(request)} failed: ${request.failure()?.errorText ?? "unknown"}`
    )
  );
};

const setActive = (state: SessionState, page: Page) => {
  state.active = page;
  state.onActivate?.(page);
};

const pushDiagnostic = (entries: string[], value: string) => {
  entries.push(value);
  if (entries.length > maximumDiagnosticEntries)
    entries.splice(0, entries.length - maximumDiagnosticEntries);
};

// A failed Nexi hosted-field call states its reason only in the response
// body. Record the provider codes alone, never the URL or body, so the driver
// can name the rejection while the run continues.
const recordNexiBuildFailure = (requests: string[], response: Response) => {
  const status = response.status();
  if (status < 400) return;
  const url = URL.parse(response.url());
  if (!(url && isNexiBuildApiUrl(url))) return;
  response.text().then(
    (text) => {
      const summary = summarizeNexiBuildFailureBody(text);
      const codes = summary ? listNexiBuildFailureCodes(summary) : [];
      if (codes.length === 0) return;
      pushDiagnostic(
        requests,
        formatNexiBuildFailureLine({
          codes,
          endpoint: toNexiBuildEndpoint(url),
          status,
        })
      );
    },
    () => undefined
  );
};

const formatConsoleMessage = (message: ConsoleMessage) =>
  `[${message.type()}] ${message.text()}`;

const formatRequest = (request: Request) =>
  `${request.method()} ${request.url()}`;

const formatResponse = (response: Response) =>
  `${response.status()} ${response.request().method()} ${response.url()}`;

/**
 * Whether a failure, or one of its causes, is Playwright's `TimeoutError`.
 * It matches the error's name rather than the class, so modules that every
 * E2E process loads, such as `runtime.ts`, never load Playwright itself.
 */
export const isPlaywrightTimeout = (cause: unknown): boolean =>
  cause instanceof Error &&
  (cause.name === "TimeoutError" || isPlaywrightTimeout(cause.cause));

const toSessionFailure = (
  label: string,
  cause: unknown,
  closing = false
): WorkspaceE2EError => {
  if (cause instanceof WorkspaceE2EError) return cause;
  const options = { operation: label };
  if (closing)
    return workspaceE2EError(
      `${label} stopped because the browser session closed`,
      options
    );
  if (cause instanceof AssertionError)
    return workspaceE2EError(
      `${label} failed: ${redact(cause.message)}`,
      options
    );
  return isPlaywrightTimeout(cause)
    ? workspaceE2ETimeoutError(`${label} timed out`, options)
    : workspaceE2EError(`${label} failed`, options);
};

/**
 * Redacts registered secrets, query values, the bypass header, and long
 * token-like runs from text bound for a failure artifact.
 */
export const sanitizeArtifactText = (text: string) =>
  sanitizeArtifactUrlText(redact(text))
    .replace(/([?&][^=&#\s]+)=[^&\s",}]+/g, "$1=[redacted]")
    .replace(/((?:%3F|%26)[^=%&\s]+)(?:%3D|=)[^%&\s",}]+/gi, "$1%3D[redacted]")
    .replace(/(x-vercel-protection-bypass[=":\s]+)[^&\s",}]+/gi, "$1[redacted]")
    .replace(/[A-Za-z0-9_-]{96,}/g, "[token]");

const sanitizeArtifactUrlText = (text: string) =>
  text.replace(/https?:\/\/[^\s"'<>]+/g, (value) => {
    try {
      const url = new URL(value);
      for (const key of url.searchParams.keys())
        url.searchParams.set(key, "[redacted]");
      return url.toString();
    } catch {
      return value;
    }
  });

// Sanitizes string values only, so short redacted values (such as test card
// fragments) cannot rewrite timings and sizes into invalid JSON.
export const sanitizeHarArtifact = (text: string) => {
  try {
    const har = JSON.parse(text) as Record<string, unknown>;
    const log = asRecord(har.log);
    const entries = Array.isArray(log?.entries) ? log.entries : [];

    for (const entry of entries) {
      const record = asRecord(entry);
      if (!record) continue;
      const request = asRecord(record.request);
      const requestUrl = typeof request?.url === "string" ? request.url : "";
      sanitizeHarRequest(request);
      sanitizeHarResponse(asRecord(record.response), requestUrl);
    }

    return JSON.stringify(redactJsonValue(har, sanitizeArtifactText), null, 2);
  } catch {
    return sanitizeArtifactText(text);
  }
};

const sanitizeHarRequest = (request: Record<string, unknown> | undefined) => {
  if (!request) return;
  if (typeof request.url === "string")
    request.url = sanitizeHarUrl(request.url);
  request.headers = sanitizeHarNamedValues(request.headers);
  request.cookies = [];
  request.queryString = sanitizeHarNamedValues(request.queryString);

  const postData = asRecord(request.postData);
  if (!postData) return;
  postData.params = [];
  if (typeof postData.text === "string") postData.text = "[redacted]";
};

const sanitizeHarResponse = (
  response: Record<string, unknown> | undefined,
  requestUrl: string
) => {
  if (!response) return;
  response.headers = sanitizeHarNamedValues(response.headers);
  response.cookies = [];

  const content = asRecord(response.content);
  if (!content || typeof content.text !== "string") return;
  const summary =
    typeof response.status === "number" &&
    response.status >= 400 &&
    isNexiBuildUrl(requestUrl)
      ? summarizeNexiBuildFailureBody(content.text)
      : undefined;
  content.text = summary ? JSON.stringify(summary) : "[redacted]";
};

const isNexiBuildUrl = (value: string) => {
  const url = URL.parse(value);
  return url ? isNexiBuildApiUrl(url) : false;
};

const sanitizeHarNamedValues = (value: unknown) =>
  Array.isArray(value)
    ? value.map((item) => {
        const record = asRecord(item);
        return record ? { ...record, value: "[redacted]" } : item;
      })
    : value;

const sanitizeHarUrl = (value: string) => {
  try {
    const url = new URL(value);
    for (const key of url.searchParams.keys())
      url.searchParams.set(key, "[redacted]");
    return sanitizeArtifactText(url.toString());
  } catch {
    return sanitizeArtifactText(value);
  }
};

const asRecord = (value: unknown) =>
  value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
