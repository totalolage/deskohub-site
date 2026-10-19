import { Effect, Schema } from "effect";
import {
  AutomationUnitDefect,
  registerAutomationUnitHandler,
} from "./automation-unit-handler";

/** The `deliver` unit: verifies, persists, submits and settles one batch of send-ready runs (§5.9). */
export const makeDeliverHandler = Effect.succeed(
  registerAutomationUnitHandler({
    kind: "deliver",
    subject: Schema.Struct({}),
    fetch: () =>
      Effect.fail(new AutomationUnitDefect({ code: "kind-unimplemented" })),
    commit: () => Effect.succeed([]),
  })
);
