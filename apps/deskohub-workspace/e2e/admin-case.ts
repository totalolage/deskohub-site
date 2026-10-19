import { AssertionError } from "node:assert";
import type { Browser, BrowserContext, Page, Request } from "@playwright/test";
import { Cause, Effect, Exit, Option } from "effect";
import { WorkspaceE2EError, workspaceE2EError } from "./errors";
import { withinWorkspaceE2EDeadline } from "./polling";
import { primePreviewAccess } from "./preview-access";
import { toE2EResult } from "./services/telemetry";
import type { WorkspaceE2EFailureReporter } from "./suite";

/**
 * Maps any browser-driver failure onto a fixed code-owned error. Raw Playwright
 * causes can embed request headers, cookies, the Vercel bypass, URLs,
 * credentials, and response bodies, so the cause is discarded instead of
 * attached, redacted, or stringified.
 */
const sanitizedBrowserFailure = (operation: string) => (): WorkspaceE2EError =>
  workspaceE2EError(`${operation} failed`, { operation });

/**
 * Runs one browser or preview-HTTP operation and maps every failure onto a
 * reporter-safe error. Only code-owned assertion failures keep their messages;
 * every other cause is discarded.
 */
export const sanitizedBrowserOperation = <A>(
  operation: string,
  run: (signal: AbortSignal) => Promise<A>
): Effect.Effect<A, WorkspaceE2EError> =>
  Effect.tryPromise({
    catch: (cause): WorkspaceE2EError =>
      cause instanceof AssertionError
        ? workspaceE2EError(`${operation} failed: ${cause.message}`, {
            operation,
          })
        : sanitizedBrowserFailure(operation)(),
    try: run,
  });

/**
 * Opens an isolated, signed-out admin browser context for the preview origin.
 * The case signs it in as a seeded synthetic administrator
 * (`e2e/administrators/identities.ts`) before it opens an admin page.
 */
export const openAdminBrowserPage = async (input: {
  readonly baseURL: string | undefined;
  readonly browser: Browser;
  readonly caseName: string;
}): Promise<{
  readonly context: BrowserContext;
  readonly origin: string;
  readonly page: Page;
}> => {
  const { baseURL } = input;
  if (!baseURL) {
    throw workspaceE2EError(
      `Playwright baseURL is required for the ${input.caseName} case`,
      { operation: `start the ${input.caseName} case` }
    );
  }
  const origin = new URL(baseURL).origin;
  let context: BrowserContext;
  try {
    context = await input.browser.newContext({
      baseURL,
      viewport: { height: 900, width: 1440 },
    });
  } catch {
    throw sanitizedBrowserFailure(
      `start the ${input.caseName} browser context`
    )();
  }
  try {
    return { context, origin, page: await context.newPage() };
  } catch {
    await context.close().catch(() => undefined);
    throw sanitizedBrowserFailure(`open the ${input.caseName} page`)();
  }
};

export const primePreviewBypass = (input: {
  readonly bypassSecret: string | undefined;
  readonly context: BrowserContext;
  readonly origin: string;
}) =>
  sanitizedBrowserOperation("prime the Vercel protection bypass cookie", () =>
    primePreviewAccess(input.context, input.origin, input.bypassSecret)
  );

/**
 * Runs the timed case body with the interruption-safe cleanup finalizer
 * attached first, then applies the caller's trace wrapper to that finalized
 * effect, and only observes the settled exit in an outer `onExit`, so the
 * annotation always describes the traced final outcome of body and cleanup
 * together and is emitted after trace finalization and cleanup.
 */
export const runFinalizedCase = <A, E, R, R2>(input: {
  readonly body: Effect.Effect<A, E, R>;
  readonly cleanup: Effect.Effect<void, never, R2>;
  readonly trace: (
    finalized: Effect.Effect<A, E, R | R2>
  ) => Effect.Effect<A, E, R | R2>;
  readonly onExit: (exit: Exit.Exit<A, E>) => void;
}): Effect.Effect<A, E, R | R2> =>
  input
    .trace(input.body.pipe(Effect.ensuring(input.cleanup)))
    .pipe(Effect.onExit((exit) => Effect.sync(() => input.onExit(exit))));

/**
 * Emits one failure annotation for a genuinely failed or timed-out admin case.
 * Interrupted siblings stay unannotated, and the annotation never masks the
 * case outcome.
 */
export const reportAdminCaseFailure =
  (input: {
    readonly caseId: string;
    readonly reportFailure: WorkspaceE2EFailureReporter | undefined;
    readonly terminalStepId: () => string | undefined;
  }) =>
  <A, E>(exit: Exit.Exit<A, E>): void => {
    if (Exit.isSuccess(exit) || !input.reportFailure) return;
    if (Cause.hasInterruptsOnly(exit.cause)) return;
    const result = toE2EResult(exit);
    if (result.outcome !== "failed" && result.outcome !== "timed_out") {
      return;
    }
    const error = Cause.findErrorOption(exit.cause);
    const terminalStepId = input.terminalStepId();
    try {
      input.reportFailure({
        caseId: input.caseId,
        ...(Option.isSome(error) &&
        error.value instanceof WorkspaceE2EError &&
        error.value.diagnosticCode
          ? { diagnosticCode: error.value.diagnosticCode }
          : {}),
        failureKind: result.failureKind,
        outcome: result.outcome,
        ...(terminalStepId ? { stepId: terminalStepId } : {}),
      });
    } catch {
      // The annotation must never mask the case outcome.
    }
  };

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
 * closes without sending one. Close the browser context before awaiting it:
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
