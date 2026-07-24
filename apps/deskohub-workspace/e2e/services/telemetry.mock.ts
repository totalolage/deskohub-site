import { Effect, Layer } from "effect";
import {
  type E2EResult,
  type E2ESpan,
  E2ETelemetryService,
  toE2EResult,
} from "./telemetry";

export type E2ETelemetryObservation = E2ESpan & E2EResult;

export const makeE2ETelemetryMock = (observations: E2ETelemetryObservation[]) =>
  Layer.succeed(E2ETelemetryService, {
    traceCase: ({ caseId, effect, timeoutMs }) =>
      observeE2EEffect(observations, { caseId, scope: "case", timeoutMs })(
        effect
      ),
    traceRun: observeE2EEffect(observations, { scope: "run" }),
    traceStep: ({ caseId, effect, stepId, timeoutMs }) =>
      observeE2EEffect(observations, {
        caseId,
        scope: "step",
        stepId,
        timeoutMs,
      })(effect),
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
