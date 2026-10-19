import { Effect, Schema } from "effect";
import {
  AutomationUnitDefect,
  registerAutomationUnitHandler,
} from "./automation-unit-handler";

/** The `fire-chunk` unit: evaluates one chunk of a schedule fire's pool and enters its customers (§5.7). */
export const makeFireChunkHandler = Effect.succeed(
  registerAutomationUnitHandler({
    kind: "fire-chunk",
    subject: Schema.Struct({}),
    fetch: () =>
      Effect.fail(new AutomationUnitDefect({ code: "kind-unimplemented" })),
    commit: () => Effect.succeed([]),
  })
);
