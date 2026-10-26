import { Cause, Effect, Exit } from "effect";
import { WorkspaceE2EProviderVerificationPermitService } from "./coordination/provider-verification-permit.service";
import type { WorkspaceE2EError } from "./errors";
import { withinWorkspaceE2EDeadline } from "./polling";
import { log } from "./runtime";
import {
  type E2EOutcome,
  E2ETelemetryService,
  findWorkspaceE2EDiagnosticCode,
  toE2EResult,
} from "./services/telemetry";
import { formatWorkspaceE2EDuration } from "./timeouts";

/** A suite-wide limit a step holds for its timed execution. */
type WorkspaceE2EStepPermit = "provider-verification";

/**
 * One semantic step. A permit admits the step before its deadline starts; the
 * wait still counts toward the step span and the case watchdog.
 */
export type WorkspaceE2EStep<
  A,
  R = never,
  P extends WorkspaceE2EStepPermit | undefined = undefined,
> = {
  readonly execute: Effect.Effect<A, WorkspaceE2EError, R>;
  readonly id: string;
  readonly permit?: P;
  readonly timeoutMs: number;
};

type WorkspaceE2EStepPermitRequirement<P> = P extends "provider-verification"
  ? WorkspaceE2EProviderVerificationPermitService
  : never;

/** Runs one step: traced, logged, deadline-bound, and permit-admitted. */
export type WorkspaceE2EStepRunner = <
  A,
  R,
  P extends WorkspaceE2EStepPermit | undefined = undefined,
>(
  step: WorkspaceE2EStep<A, R, P>
) => Effect.Effect<
  A,
  WorkspaceE2EError,
  R | WorkspaceE2EStepPermitRequirement<P>
>;

const e2eOutcomeStatus: Record<E2EOutcome, string> = {
  cancelled: "CANCEL",
  failed: "FAIL",
  passed: "PASS",
  timed_out: "TIMEOUT",
};

/**
 * Runs one Playwright test's E2E case. The body runs inside the case watchdog
 * and gets the step runner. A genuine body failure runs `onFailure` while the
 * case's resources are still open; `cleanup` then runs after success, failure,
 * timeout, or interruption as the traced case finalization phase. The case
 * span settles over body and cleanup together, and only then does a genuinely
 * failed or timed-out case emit its one annotation with the last step that
 * did not pass. Interrupted cases never annotate, and an annotation failure
 * never masks the case outcome.
 */
export const runE2ECase = <R, RC = never, RF = never>(input: {
  readonly body: (
    step: WorkspaceE2EStepRunner
  ) => Effect.Effect<void, WorkspaceE2EError, R>;
  readonly caseId: string;
  readonly cleanup?: Effect.Effect<void, WorkspaceE2EError, RC>;
  readonly onFailure?: (
    cause: Cause.Cause<WorkspaceE2EError>
  ) => Effect.Effect<void, never, RF>;
  readonly watchdogMs: number;
}): Effect.Effect<void, WorkspaceE2EError, R | RC | RF | E2ETelemetryService> =>
  Effect.gen(function* () {
    const telemetry = yield* E2ETelemetryService;
    const { caseId, cleanup, onFailure, watchdogMs } = input;
    let terminalStepId: string | undefined;
    let bodyDurationMs = 0;

    const step: WorkspaceE2EStepRunner = <
      A,
      R,
      P extends WorkspaceE2EStepPermit | undefined = undefined,
    >({
      execute,
      id,
      permit,
      timeoutMs,
    }: WorkspaceE2EStep<A, R, P>) => {
      const operation = `${caseId}/${id}`;
      const timed = withinWorkspaceE2EDeadline(execute, operation, timeoutMs);
      // The permit's service requirement is exactly what the runner's
      // conditional type adds for `P`; TypeScript can't narrow `P` here.
      const admitted = (
        permit === "provider-verification"
          ? Effect.gen(function* () {
              const providerVerification =
                yield* WorkspaceE2EProviderVerificationPermitService;
              return yield* providerVerification.withPermit(timed);
            })
          : timed
      ) as Effect.Effect<
        A,
        WorkspaceE2EError,
        R | WorkspaceE2EStepPermitRequirement<P>
      >;

      return telemetry.traceStep({
        caseId,
        effect: Effect.suspend(() => {
          const startedAt = Date.now();
          return Effect.sync(() => log(`STEP START ${operation}`)).pipe(
            Effect.andThen(admitted),
            Effect.onExit((exit) =>
              Effect.sync(() => {
                const { outcome } = toE2EResult(exit);
                if (outcome !== "passed") terminalStepId = id;
                const elapsed = formatWorkspaceE2EDuration(
                  Date.now() - startedAt
                );
                log(
                  `STEP ${e2eOutcomeStatus[outcome]} ${operation} (${elapsed})`
                );
              })
            )
          );
        }),
        stepId: id,
        timeoutMs,
      });
    };

    const watched = Effect.suspend(() => {
      const startedAt = Date.now();
      return Effect.sync(() => log(`CASE START ${caseId}`)).pipe(
        Effect.andThen(
          withinWorkspaceE2EDeadline(
            input.body(step),
            `${caseId} e2e case`,
            watchdogMs
          )
        ),
        Effect.onExit(() =>
          Effect.sync(() => {
            bodyDurationMs = Date.now() - startedAt;
          })
        )
      );
    });
    const observed = onFailure
      ? watched.pipe(
          Effect.tapCause((cause) =>
            Cause.hasInterruptsOnly(cause) ? Effect.void : onFailure(cause)
          )
        )
      : watched;
    const finalized = cleanup
      ? Effect.acquireUseRelease(
          Effect.void,
          () => observed,
          () =>
            telemetry.tracePhase({
              caseId,
              effect: cleanup,
              phaseId: "case-finalization",
            })
        )
      : observed;

    yield* telemetry
      .traceCase({
        caseId,
        effect: finalized.pipe(
          Effect.onExit((exit) =>
            Effect.sync(() => {
              const status = e2eOutcomeStatus[toE2EResult(exit).outcome];
              const elapsed = formatWorkspaceE2EDuration(bodyDurationMs);
              log(`CASE ${status} ${caseId} (${elapsed})`);
            })
          )
        ),
        timeoutMs: watchdogMs,
      })
      .pipe(
        Effect.tapCause((cause) => {
          const result = toE2EResult(Exit.failCause(cause));
          if (result.outcome !== "failed" && result.outcome !== "timed_out") {
            return Effect.void;
          }
          const diagnosticCode = findWorkspaceE2EDiagnosticCode(cause);
          // Suspended so an adapter that throws before returning its Effect is
          // isolated too.
          return Effect.suspend(() =>
            telemetry.annotateFailure({
              caseId,
              ...(diagnosticCode ? { diagnosticCode } : {}),
              failureKind: result.failureKind,
              outcome: result.outcome,
              ...(terminalStepId ? { stepId: terminalStepId } : {}),
            })
          ).pipe(
            Effect.catchCause(() =>
              Effect.sync(() => log("Workspace E2E failure reporter failed"))
            )
          );
        })
      );
  });
