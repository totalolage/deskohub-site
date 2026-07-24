import { Effect, Layer } from "effect";
import { type E2ETelemetryEvent, E2ETelemetryService } from "./telemetry";

export const makeE2ETelemetryMock = (events: E2ETelemetryEvent[]) =>
  Layer.succeed(E2ETelemetryService, {
    record: (event) =>
      Effect.sync(() => {
        events.push(event);
      }),
  });
