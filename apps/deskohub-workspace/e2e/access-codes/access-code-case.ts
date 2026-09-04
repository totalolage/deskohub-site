import "../../shared/polyfills/temporal";

import { AssertionError } from "node:assert";
import { AdministrationStandaloneAccessCodeName } from "@deskohub/workspace-admin-api";
import { WORKSPACE_SITE_TIME_ZONE } from "@deskohub/workspace-admin-api/site-time-zone";
import { Effect, Exit, Schema } from "effect";
import { WorkspaceE2EError, workspaceE2EError } from "../errors";
import { withinWorkspaceE2EDeadline } from "../polling";

export interface AccessCodeCreationPlan {
  readonly endsAtLocal: string;
  readonly name: AdministrationStandaloneAccessCodeName;
  readonly startsAtLocal: string;
}

const syntheticAccessCodeNamePrefix = "dsk-e2e-";
const maximumSyntheticAccessCodeNameLength = 60;
const accessCodeWindowLeadHours = 2;
const accessCodeWindowDurationHours = 3;

export const makeSyntheticAccessCodeName =
  (): AdministrationStandaloneAccessCodeName => {
    const name = `${syntheticAccessCodeNamePrefix}${crypto.randomUUID()}`;
    if (name.length > maximumSyntheticAccessCodeNameLength) {
      throw new Error(
        "The synthetic access code name exceeds the provider access-name bound"
      );
    }
    return Schema.decodeSync(AdministrationStandaloneAccessCodeName)(name);
  };

export const planAccessCodeCreationAttempt = (input: {
  readonly name: AdministrationStandaloneAccessCodeName;
  readonly now?: Temporal.Instant;
}): AccessCodeCreationPlan => {
  const now = input.now ?? Temporal.Now.instant();
  const start = now
    .toZonedDateTimeISO(WORKSPACE_SITE_TIME_ZONE)
    .round({ roundingMode: "ceil", smallestUnit: "hour" })
    .add({ hours: accessCodeWindowLeadHours });
  const end = start.add({ hours: accessCodeWindowDurationHours });

  return {
    endsAtLocal: formatWholeHourLocal(end),
    name: input.name,
    startsAtLocal: formatWholeHourLocal(start),
  };
};

/**
 * Maps any browser-driver failure onto a fixed code-owned error. Raw Playwright
 * causes can embed request headers, cookies, the Vercel bypass, URLs,
 * credentials, and response bodies, so the cause is discarded instead of
 * attached, redacted, or stringified.
 */
export const sanitizedBrowserFailure =
  (operation: string) =>
  (): WorkspaceE2EError =>
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

const hopByHopAndClientOwnedHeaders = new Set([
  "authorization",
  "connection",
  "content-length",
  "cookie",
  "host",
  "transfer-encoding",
  "x-vercel-protection-bypass",
  "x-vercel-set-bypass-cookie",
]);

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

export type ActionResponseOutcome =
  | { readonly kind: "responded" }
  | { readonly kind: "unresolved" };

/**
 * Server Actions keep running after a browser disconnect, so cleanup waits for
 * each retained mutation response within explicit headroom. The initial form
 * action may fall back to converging on the persisted terminal state because
 * no terminal exists yet; a replay has no such proof — an already-existing
 * terminal event cannot show its server work settled — so an unresolved replay
 * fails closed without deleting.
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
    const responded = yield* withinWorkspaceE2EDeadline(
      Effect.promise(() => responseSettled),
      `await the ${input.label} completion barrier`,
      input.barrierTimeoutMs
    ).pipe(
      Effect.map((outcome) => outcome.kind === "responded"),
      Effect.catch(() => Effect.succeed(false))
    );
    if (responded) return;
    if (!input.waitForTerminalEvent) {
      return yield* workspaceE2EError(
        `The ${input.label} response did not settle before cleanup, so synthetic rows must not be deleted`,
        { operation: `await the ${input.label} completion barrier` }
      );
    }
    yield* input.waitForTerminalEvent;
  });

export const selectActionReplayHeaders = (
  headers: Record<string, string | undefined>
): Record<string, string> => {
  const replayHeaders: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (hopByHopAndClientOwnedHeaders.has(name.toLowerCase())) continue;
    replayHeaders[name] = value;
  }
  return replayHeaders;
};

const formatWholeHourLocal = (value: Temporal.ZonedDateTime) =>
  value.toPlainDateTime().toString({ smallestUnit: "minute" });
