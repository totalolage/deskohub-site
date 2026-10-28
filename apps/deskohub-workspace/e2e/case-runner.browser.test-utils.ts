import { randomUUID } from "node:crypto";
import type { Browser } from "@playwright/test";
import { Effect, Exit } from "effect";
import type { E2EBrowserSession } from "./browser-session";
import { runE2ECase } from "./case-runner";
import { isWorkspaceE2ETimeout, type WorkspaceE2EError } from "./errors";
import {
  browserSessionFor,
  makePlaywrightBrowserRunner,
  type Runner,
} from "./runtime";
import {
  type E2ETelemetryObservation,
  makeE2ETelemetryMock,
} from "./services/telemetry.mock";

/** The browser a step drives: the argv runner and its session for `id`. */
export type BrowserStepDriver = {
  readonly id: string;
  readonly run: Runner;
  readonly session: E2EBrowserSession;
};

const browserStepCaseId = "browser-step";
const browserStepId = "drive-browser-step";

/**
 * Runs `drive` as the one step of a C03 case over a fresh argv runner on
 * real Chromium, after `prepare` has set up the session's page in the case
 * body. Reports the case annotations, the step observations, the step's
 * failures and what `drive` returned. `afterStep` runs on the same session
 * once the case has settled; the runner closes last.
 */
export const runBrowserStep = async <A>({
  afterStep,
  browser,
  drive,
  prepare,
  stepTimeoutMs = 15_000,
}: {
  readonly afterStep?: (
    driver: BrowserStepDriver
  ) => Effect.Effect<void, WorkspaceE2EError>;
  readonly browser: Browser;
  readonly drive: (
    driver: BrowserStepDriver
  ) => Effect.Effect<A, WorkspaceE2EError>;
  readonly prepare: (
    session: E2EBrowserSession
  ) => Effect.Effect<void, WorkspaceE2EError>;
  readonly stepTimeoutMs?: number;
}) => {
  const run = makePlaywrightBrowserRunner(browser, { recordHar: false });
  const id = `browser-step-${randomUUID()}`;
  const observations: E2ETelemetryObservation[] = [];
  const failures: WorkspaceE2EError[] = [];
  let value: A | undefined;
  try {
    const exit = await Effect.runPromiseExit(
      runE2ECase({
        body: (step) =>
          Effect.gen(function* () {
            const session = yield* browserSessionFor(run, id);
            yield* prepare(session);
            value = yield* step({
              execute: drive({ id, run, session }).pipe(
                Effect.tapError((failure) =>
                  Effect.sync(() => failures.push(failure))
                )
              ),
              id: browserStepId,
              timeoutMs: stepTimeoutMs,
            });
          }),
        caseId: browserStepCaseId,
        watchdogMs: 60_000,
      }).pipe(Effect.provide(makeE2ETelemetryMock(observations)))
    );
    if (afterStep) {
      await Effect.runPromise(
        Effect.flatMap(browserSessionFor(run, id), (session) =>
          afterStep({ id, run, session })
        )
      );
    }
    return {
      annotations: observations
        .filter(({ scope }) => scope === "annotation")
        .map(({ scope: _scope, ...annotation }) => annotation),
      failures: failures.map((failure) => ({
        message: failure.message,
        timeout: isWorkspaceE2ETimeout(failure),
      })),
      steps: observations.flatMap(({ scope, ...observation }) =>
        scope === "step" ? [observation] : []
      ),
      succeeded: Exit.isSuccess(exit),
      value,
    };
  } finally {
    await run.close?.();
  }
};

/** The one annotation a step that failed this way leaves on its case. */
export const failedStepAnnotation = (failureKind: "error" | "timeout") => [
  failureKind === "timeout"
    ? {
        caseId: browserStepCaseId,
        failureKind: "timeout" as const,
        outcome: "timed_out" as const,
        stepId: browserStepId,
      }
    : {
        caseId: browserStepCaseId,
        failureKind: "error" as const,
        outcome: "failed" as const,
        stepId: browserStepId,
      },
];
