import { AssertionError } from "node:assert";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type {
  Browser,
  BrowserContext,
  ConsoleMessage,
  Cookie,
  Page,
  Request,
  Response,
} from "@playwright/test";
import { Cause, Deferred, Effect, Exit, FiberSet, type Scope } from "effect";
import {
  sanitizeArtifactText,
  sanitizeHarArtifact,
} from "./artifact-sanitization";
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
import { primePreviewAccess } from "./preview-access";
import { redact } from "./redaction";
import { workspaceE2ETimeouts } from "./timeouts";

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

/**
 * One cookie of the context for an origin: its attributes and whether it
 * holds an expected value, never the value itself.
 */
export type E2EBrowserCookieDescription =
  | { readonly present: false }
  | {
      readonly httpOnly: boolean;
      /** Whole days until it expires; `null` for a session cookie. */
      readonly lifetimeDays: number | null;
      /** Whether it holds the expected value; `null` when none was given. */
      readonly matches: boolean | null;
      readonly path: string;
      readonly present: true;
      readonly sameSite: "Lax" | "None" | "Strict";
      readonly secure: boolean;
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
 * capture across every page, preview access priming, redaction, and failure
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
  /**
   * Saves what the browser saw into `directory` for failure triage, then
   * closes the session: `network-requests.txt`, `console.txt` and
   * `errors.txt` from the capture, the active page's
   * `snapshot-interactive.txt`, and, when the session records a HAR,
   * `network.har`, which the close exports. Every artifact is sanitized. A
   * snapshot that can't be read is written empty and a failed close leaves no
   * HAR; only a failed write fails the capture. The snapshot read and the
   * close are not bounded here beyond Playwright's own timeouts, so the
   * caller bounds the whole capture.
   */
  readonly captureFailureArtifacts: (
    directory: string
  ) => Effect.Effect<void, WorkspaceE2EError>;
  readonly clearDiagnostics: (
    kind: keyof E2EBrowserDiagnostics
  ) => Effect.Effect<void>;
  /**
   * Closes the context so Playwright flushes its HAR, writes the sanitized
   * HAR to `harPath` when one was recorded, and deletes the raw file even
   * when the export fails. The first call decides the export and cannot be
   * interrupted; later calls wait for it and share its outcome, and fail when
   * they ask for a HAR the first call did not write. The Scope finalizer
   * closes the context and deletes the raw file too, waiting for the close
   * at most one browser action.
   */
  readonly close: (options?: {
    readonly harPath?: string;
  }) => Effect.Effect<void, WorkspaceE2EError>;
  /**
   * Describes the context's cookie `name` for the URL's origin, comparing it
   * with `value` when one is given. The value never leaves the session.
   */
  readonly describeCookie: (query: {
    readonly name: string;
    readonly url: string;
    readonly value?: string;
  }) => Effect.Effect<E2EBrowserCookieDescription, WorkspaceE2EError>;
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
   * Lets the context through Vercel protection on the URL's origin with
   * `primePreviewAccess` (`preview-access.ts`): the secret is exchanged
   * outside Playwright and only Vercel's cookie enters the context. An origin
   * is primed once the probe is accepted, with or without a cookie, or when it
   * is not a Workspace deployment origin and so never gets the secret. Each
   * origin is probed once; concurrent calls share the probe, bounded by the
   * first call's `timeoutMs`, and interrupting a caller stops only its wait.
   * A failed probe fails every waiter and leaves the origin unprimed, so the
   * next call probes again. Without a secret it does nothing.
   */
  readonly primePreviewAccess: (
    url: string,
    bypassSecret: string | undefined,
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
  /** Each origin's probe; a failed probe is removed, a settled one kept. */
  readonly previewAccess: Map<
    string,
    Deferred.Deferred<void, WorkspaceE2EError>
  >;
  readonly registeredPages: WeakSet<Page>;
};

const maximumDiagnosticEntries = 500;
const snapshotTimeoutMs = 60_000;

const open = Effect.fn("E2EBrowserSession.open")(function* (options: {
  /** Resolves relative `page.goto` URLs, as Playwright's `baseURL` does. */
  readonly baseURL?: string;
  readonly browser: Browser;
  /**
   * Exchanges the preview bypass secret; the global `fetch` by default.
   * Tests point a Workspace deployment origin at a local server with it.
   */
  readonly fetch?: typeof fetch;
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
  // Preview access probes outlive the caller that started them; closing the
  // session interrupts them.
  const probes = yield* FiberSet.make<void, WorkspaceE2EError>();

  const closeAndExport = Effect.fn("E2EBrowserSession.close")(
    function* (context: BrowserContext, harPath: string | undefined) {
      yield* FiberSet.clear(probes);
      yield* Effect.tryPromise({
        catch: (cause) => toSessionFailure("close the browser context", cause),
        try: () => context.close({ reason: "Workspace E2E case complete" }),
      });
      if (!(rawHarPath && harPath)) return;
      const har = yield* Effect.tryPromise({
        catch: (cause) => toSessionFailure("read the browser HAR", cause),
        try: () => readFile(rawHarPath, "utf8"),
      });
      yield* Effect.tryPromise({
        catch: (cause) => toSessionFailure("write the browser HAR", cause),
        try: () => writeFile(harPath, `${sanitizeHarArtifact(har)}\n`),
      });
    },
    (effect) =>
      rawHarPath ? Effect.ensuring(effect, removeFile(rawHarPath)) : effect
  );

  // The first close runs detached, so an interrupted or timed-out caller
  // stops only its own wait; every caller, the Scope included, shares its
  // outcome.
  const closed = yield* Deferred.make<void, WorkspaceE2EError>();
  let closeRequest: { readonly harPath?: string } | undefined;
  // Closing starts with the first close request, before the context closes.
  const isClosing = () => closeRequest !== undefined;
  const startClose = (context: BrowserContext, harPath: string | undefined) =>
    Effect.uninterruptible(
      Effect.suspend(() => {
        if (closeRequest) return Effect.succeed(closeRequest.harPath);
        closeRequest = { harPath };
        return Effect.forkDetach(
          closeAndExport(context, harPath).pipe(
            Effect.onExit((exit) => Deferred.done(closed, exit))
          )
        ).pipe(Effect.as(harPath));
      })
    );
  const closeSession = (context: BrowserContext, harPath?: string) =>
    startClose(context, harPath).pipe(
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

  // Acquired uninterruptibly, so a context created while the caller was
  // interrupted still gets its release. The release, the Scope's only wait
  // on the browser, waits for the shared close at most one browser action:
  // a stalled `context.close()` must not hold up the Scope, and the detached
  // close still finishes and removes the raw HAR.
  const context = yield* Effect.acquireRelease(
    Effect.tryPromise({
      catch: (cause) => toSessionFailure("open the browser context", cause),
      try: () =>
        options.browser.newContext({
          baseURL: options.baseURL,
          recordHar: rawHarPath
            ? { content: "embed", mode: "full", path: rawHarPath }
            : undefined,
          viewport: { height: 900, width: 1440 },
        }),
    }),
    (context) =>
      closeSession(context).pipe(
        Effect.timeout(`${workspaceE2ETimeouts.browserAction} millis`),
        Effect.ignore
      )
  );

  const initialPage = yield* Effect.tryPromise({
    catch: (cause) => toSessionFailure("open the browser page", cause),
    try: () => context.newPage(),
  });
  const state: SessionState = {
    active: initialPage,
    onActivate: options.onActivate,
    diagnostics: { console: [], errors: [], requests: [] },
    previewAccess: new Map(),
    registeredPages: new WeakSet(),
  };
  context.on("page", (page) => registerPage(state, context, page));
  registerPage(state, context, initialPage);

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
  const close = ({ harPath }: { readonly harPath?: string } = {}) =>
    closeSession(context, harPath);
  const diagnostics = Effect.sync(() => ({
    console: state.diagnostics.console.map(redact),
    errors: state.diagnostics.errors.map(redact),
    requests: state.diagnostics.requests.map(redact),
  }));

  return {
    captureFailureArtifacts: Effect.fn(
      "E2EBrowserSession.captureFailureArtifacts"
    )(function* (directory: string) {
      const captured = yield* diagnostics;
      yield* writeArtifactText(
        directory,
        "network-requests.txt",
        asCapturedLog(captured.requests.join("\n"))
      );
      yield* writeArtifactText(
        directory,
        "console.txt",
        asCapturedLog(captured.console.join("\n"))
      );
      yield* writeArtifactText(
        directory,
        "errors.txt",
        asCapturedLog(captured.errors.join("\n\n"))
      );
      const snapshot = yield* use(
        "read interactive browser snapshot",
        async (page) => {
          const body = page.locator("body");
          await body.waitFor({
            state: "attached",
            timeout: snapshotTimeoutMs,
          });
          return body.ariaSnapshot({
            mode: "ai",
            timeout: snapshotTimeoutMs,
          });
        }
      ).pipe(Effect.orElseSucceed(() => ""));
      yield* writeArtifactText(directory, "snapshot-interactive.txt", snapshot);
      yield* close(
        rawHarPath ? { harPath: resolve(directory, "network.har") } : {}
      ).pipe(Effect.ignore);
    }),
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
    describeCookie: ({ name, url, value }) =>
      Effect.suspend(() => {
        const origin = URL.parse(url)?.origin;
        if (!origin || origin === "null")
          return Effect.fail(
            workspaceE2EError("Cookie queries need an absolute URL", {
              operation: readCookieOperation,
            })
          );
        return Effect.tryPromise({
          catch: (cause) =>
            toSessionFailure(readCookieOperation, cause, isClosing()),
          try: () => context.cookies(origin),
        }).pipe(
          Effect.map((cookies) =>
            describeCookie(
              cookies.find((cookie) => cookie.name === name),
              value
            )
          )
        );
      }),
    diagnostics,
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
    primePreviewAccess: (url, bypassSecret, { timeoutMs }) =>
      Effect.suspend(() => {
        const origin = URL.parse(url)?.origin;
        if (!origin)
          return Effect.fail(
            workspaceE2EError("Preview access needs an absolute URL", {
              operation: "prime preview access",
            })
          );
        if (!bypassSecret) return Effect.void;
        if (isClosing())
          return Effect.fail(
            toSessionFailure("prime preview access", undefined, true)
          );
        const probe = (primed: Deferred.Deferred<void, WorkspaceE2EError>) =>
          Effect.tryPromise({
            catch: (cause) =>
              toSessionFailure("prime preview access", cause, isClosing()),
            try: (signal) =>
              primePreviewAccess(context, origin, bypassSecret, {
                fetch: options.fetch,
                signal,
                timeoutMs,
              }),
          }).pipe(
            Effect.interruptible,
            Effect.onExit((exit) =>
              Effect.suspend(() => {
                if (Exit.isSuccess(exit)) return Deferred.done(primed, exit);
                state.previewAccess.delete(origin);
                // Only the session's close interrupts a probe; its waiters
                // fail as cut off by the close rather than as interrupted.
                return Cause.hasInterruptsOnly(exit.cause)
                  ? Deferred.fail(
                      primed,
                      toSessionFailure("prime preview access", undefined, true)
                    )
                  : Deferred.done(primed, exit);
              })
            )
          );
        // Registered and forked together, so no caller can find a probe that
        // never started. The probe belongs to the session, not to the first
        // caller, so only the session's close ends it early.
        const started = Effect.uninterruptible(
          Effect.suspend(() => {
            const existing = state.previewAccess.get(origin);
            if (existing) return Effect.succeed(existing);
            const primed = Deferred.makeUnsafe<void, WorkspaceE2EError>();
            state.previewAccess.set(origin, primed);
            return FiberSet.run(probes, probe(primed)).pipe(Effect.as(primed));
          })
        );
        return Effect.flatMap(started, Deferred.await);
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

const readCookieOperation = "read browser cookie";

const describeCookie = (
  cookie: Cookie | undefined,
  expectedValue: string | undefined
): E2EBrowserCookieDescription =>
  cookie === undefined
    ? { present: false }
    : {
        httpOnly: cookie.httpOnly,
        lifetimeDays:
          cookie.expires < 0
            ? null
            : Math.round((cookie.expires - Date.now() / 1000) / 86_400),
        matches:
          expectedValue === undefined ? null : cookie.value === expectedValue,
        path: cookie.path,
        present: true,
        sameSite: cookie.sameSite,
        secure: cookie.secure,
      };

// The capture logs keep the layout the argv runner gave them, which failure
// triage reads: an exit code, then the log when it has entries.
const asCapturedLog = (text: string) =>
  text ? `exitCode: 0\n\nstdout:\n${text}` : "exitCode: 0";

// Bounded like the context release, so a stuck filesystem can't hold a Scope.
const removeFile = (path: string) =>
  Effect.tryPromise(() => rm(path, { force: true })).pipe(
    Effect.timeout(`${workspaceE2ETimeouts.browserAction} millis`),
    Effect.ignore
  );

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
 * Writes one sanitized failure artifact, creating its directory when needed.
 */
export const writeArtifactText = (
  directory: string,
  fileName: string,
  text: string
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.tryPromise({
    catch: (cause) => toSessionFailure(`write ${fileName} artifact`, cause),
    try: async () => {
      await mkdir(directory, { recursive: true });
      await writeFile(
        resolve(directory, fileName),
        `${sanitizeArtifactText(text.trim())}\n`
      );
    },
  });
