import { Effect, Layer } from "effect";
import {
  type E2EResult,
  type E2ESpan,
  type E2ETelemetry,
  E2ETelemetryService,
  toE2EResult,
  type WorkspaceE2EFailureDiagnostic,
} from "./telemetry";

export type E2ETelemetryObservation =
  | (E2ESpan & E2EResult)
  | (WorkspaceE2EFailureDiagnostic & { readonly scope: "annotation" });

/**
 * Records every settled span and failure annotation in order. `overrides`
 * replaces individual adapter operations, such as a failing annotation writer.
 */
export const makeE2ETelemetryMock = (
  observations: E2ETelemetryObservation[],
  overrides: Partial<E2ETelemetry> = {}
) =>
  Layer.succeed(E2ETelemetryService, {
    annotateFailure: (diagnostic) =>
      Effect.sync(() => {
        observations.push({ ...diagnostic, scope: "annotation" });
      }),
    traceCase: ({ caseId, effect, timeoutMs }) =>
      observeE2EEffect(observations, { caseId, scope: "case", timeoutMs })(
        effect
      ),
    tracePhase: ({ caseId, effect, phaseId }) =>
      observeE2EEffect(observations, {
        ...(caseId ? { caseId } : {}),
        phaseId,
        scope: "phase",
      })(effect),
    traceRun: observeE2EEffect(observations, { scope: "run" }),
    traceStep: ({ caseId, effect, stepId, timeoutMs }) =>
      observeE2EEffect(observations, {
        caseId,
        scope: "step",
        stepId,
        timeoutMs,
      })(effect),
    ...overrides,
  });

const observeE2EEffect =
  (observations: E2ETelemetryObservation[], span: E2ESpan) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    effect.pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          observations.push({ ...span, ...toE2EResult(exit) });
        })
      )
    );
