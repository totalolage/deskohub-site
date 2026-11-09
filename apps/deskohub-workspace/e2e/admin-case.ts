import { AssertionError } from "node:assert";
import type { Browser, BrowserContext, Page, Request } from "@playwright/test";
import { Effect } from "effect";
import { E2EBrowserSession } from "./browser-session";
import {
  isWorkspaceE2ETimeout,
  WorkspaceE2EError,
  workspaceE2EError,
} from "./errors";
import { withinWorkspaceE2EDeadline } from "./polling";
import { primePreviewAccess } from "./preview-access";
import { redact } from "./redaction";

/**
 * Admin cases count only a step's own deadline as a timeout. A timeout inside
 * the step, from a Playwright action, the browser, or the preview access
 * probe, fails it like any other browser failure, so the case runner reports
 * it as failed rather than timed out.
 */
const asAdminFailure = (
  error: WorkspaceE2EError,
  operation: string
): WorkspaceE2EError =>
  isWorkspaceE2ETimeout(error)
    ? workspaceE2EError(`${operation} failed`, { operation })
    : error;

/**
 * Admin callbacks keep only a code-owned assertion's message. Anything else a
 * callback throws, a `WorkspaceE2EError` and its diagnostic code included,
 * becomes a fixed failure of the call, so a case reports only codes its
 * runner owns.
 */
const adminCallbackFailure =
  (label: string) =>
  (cause: unknown): WorkspaceE2EError =>
    cause instanceof AssertionError
      ? workspaceE2EError(`${label} failed: ${redact(cause.message)}`, {
          operation: label,
        })
      : workspaceE2EError(`${label} failed`, { operation: label });

const withinAdminDeadline = <A>(
  attempt: Effect.Effect<A, WorkspaceE2EError>,
  label: string,
  timeoutMs: number | undefined
) =>
  timeoutMs === undefined
    ? attempt
    : withinWorkspaceE2EDeadline(attempt, label, timeoutMs);

/**
 * Opens an isolated, signed-out admin browser session for the preview origin,
 * bound to the caller's Scope, with the admin failure policies
 * (`asAdminFailure`, `adminCallbackFailure`). The case primes preview access and signs it in as a
 * seeded synthetic administrator (`e2e/administrators/identities.ts`) before
 * it opens an admin page. Admin cases have no HAR consumer, so the session
 * records none; Playwright still keeps its failure screenshot.
 */
export const openAdminSession = Effect.fn("openAdminSession")(
  function* (input: {
    readonly baseURL: string | undefined;
    readonly browser: Browser;
    readonly caseName: string;
    /** The session's preview access `fetch`; tests point it at a local server. */
    readonly fetch?: typeof fetch;
  }) {
    const { baseURL } = input;
    if (!baseURL) {
      return yield* workspaceE2EError(
        `Playwright baseURL is required for the ${input.caseName} case`,
        { operation: `start the ${input.caseName} case` }
      );
    }
    const session = yield* E2EBrowserSession.open({
      baseURL,
      browser: input.browser,
      fetch: input.fetch,
      id: input.caseName,
      recordHar: false,
    }).pipe(
      Effect.mapError((error) =>
        asAdminFailure(error, error.operation ?? "open the browser session")
      )
    );
    // The session lets a callback's own `WorkspaceE2EError` through, so admin
    // drives the active page under its own callback policy.
    const use = <A>(
      label: string,
      drive: (page: Page) => Promise<A>,
      timeoutMs: number | undefined
    ) =>
      withinAdminDeadline(
        session
          .use(label, (page) => Promise.resolve(page))
          .pipe(
            Effect.mapError((error) => asAdminFailure(error, label)),
            Effect.flatMap((page) =>
              Effect.tryPromise({
                catch: adminCallbackFailure(label),
                try: () => drive(page),
              })
            )
          ),
        label,
        timeoutMs
      );
    const adminSession: E2EBrowserSession = {
      ...session,
      evaluate: <A, Arg>(
        label: string,
        fn: (arg: Arg) => A | Promise<A>,
        arg: Arg,
        deadline?: { readonly timeoutMs?: number }
      ) =>
        use(
          label,
          // Playwright types the argument as its serialized form; plain data
          // is the same shape.
          (page) => page.evaluate(fn as (arg: unknown) => A | Promise<A>, arg),
          deadline?.timeoutMs
        ),
      primePreviewAccess: (url, bypassSecret, options) =>
        session
          .primePreviewAccess(url, bypassSecret, options)
          .pipe(
            Effect.mapError((error) =>
              asAdminFailure(error, "prime preview access")
            )
          ),
      use: (label, drive, deadline) => use(label, drive, deadline?.timeoutMs),
    };
    return { origin: new URL(baseURL).origin, session: adminSession };
  }
);

const primePreviewBypassOperation = "prime the Vercel protection bypass cookie";

/**
 * Primes preview access for a browser context outside a session, as the agent
 * evals' own browser needs, with the admin failure policy. Preview access's
 * own failures keep their status; any other cause is discarded.
 */
export const primePreviewBypass = (input: {
  readonly bypassSecret: string | undefined;
  readonly context: BrowserContext;
  /** Tests point the probe at a local server. */
  readonly fetch?: typeof fetch;
  readonly origin: string;
  readonly timeoutMs?: number;
}) =>
  Effect.tryPromise({
    catch: (cause) =>
      cause instanceof WorkspaceE2EError
        ? asAdminFailure(cause, primePreviewBypassOperation)
        : workspaceE2EError(`${primePreviewBypassOperation} failed`, {
            operation: primePreviewBypassOperation,
          }),
    try: (signal) =>
      primePreviewAccess(input.context, input.origin, input.bypassSecret, {
        fetch: input.fetch,
        signal,
        timeoutMs: input.timeoutMs,
      }),
  });

export type ActionResponseOutcome =
  | { readonly kind: "responded" }
  | { readonly kind: "undispatched" }
  | { readonly kind: "unresolved" };

/**
 * Server Actions keep running after a browser disconnect, so cleanup waits for
 * each retained mutation response within explicit headroom. An action whose
 * request never left the browser has nothing in flight. An unresolved action
 * may fall back to converging on its persisted terminal state when the caller
 * can observe one; without that proof it fails closed without deleting.
 */
export const awaitActionQuiescence = <E = never, R = never>(input: {
  readonly barrierTimeoutMs: number;
  readonly label: string;
  readonly responseSettled: Promise<ActionResponseOutcome> | undefined;
  readonly waitForTerminalEvent?: Effect.Effect<boolean, E, R>;
}): Effect.Effect<void, E | WorkspaceE2EError, R> =>
  Effect.gen(function* () {
    const responseSettled = input.responseSettled;
    if (!responseSettled) return;
    const outcome = yield* withinWorkspaceE2EDeadline(
      Effect.promise(() => responseSettled),
      `await the ${input.label} completion barrier`,
      input.barrierTimeoutMs
    ).pipe(
      Effect.orElseSucceed(
        (): ActionResponseOutcome => ({ kind: "unresolved" })
      )
    );
    if (outcome.kind !== "unresolved") return;
    if (!input.waitForTerminalEvent) {
      return yield* workspaceE2EError(
        `The ${input.label} response did not settle before cleanup, so synthetic rows must not be deleted`,
        { operation: `await the ${input.label} completion barrier` }
      );
    }
    yield* input.waitForTerminalEvent;
  });

/**
 * Retains a submitted action's outcome, so cleanup can wait on it even when the
 * step that registered it is interrupted. A request that never left the
 * browser settles as undispatched; one without a response as unresolved.
 */
export const retainActionSubmission = (
  request: Promise<Pick<Request, "response">>
): Promise<ActionResponseOutcome> =>
  request.then(
    (dispatched) =>
      dispatched.response().then(
        (response): ActionResponseOutcome =>
          response ? { kind: "responded" } : { kind: "unresolved" },
        (): ActionResponseOutcome => ({ kind: "unresolved" })
      ),
    (): ActionResponseOutcome => ({ kind: "undispatched" })
  );

type ServerActionRequest = Pick<
  Request,
  "headers" | "method" | "response" | "url"
>;

/**
 * Retains the next Server Action request the page sends to `origin`. The wait
 * has no timeout, so the submission settles as undispatched only when the page
 * closes without sending one. Close the browser session before awaiting it:
 * after the close, no late request can leave the browser.
 */
export const retainServerActionSubmission = (
  page: {
    readonly waitForRequest: (
      predicate: (request: ServerActionRequest) => boolean,
      options: { readonly timeout: number }
    ) => Promise<ServerActionRequest>;
  },
  origin: string
): Promise<ActionResponseOutcome> =>
  retainActionSubmission(
    page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        request.url().startsWith(origin) &&
        request.headers()["next-action"] !== undefined,
      { timeout: 0 }
    )
  );
