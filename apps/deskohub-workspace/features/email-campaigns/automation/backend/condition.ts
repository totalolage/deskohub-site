import { Effect, Schema } from "effect";
import {
  AutomationUnitDefect,
  registerAutomationUnitHandler,
} from "./automation-unit-handler";

/** The `condition` unit: evaluates one `(version, step)` Condition for its runs (§5.8). */
export const makeConditionHandler = Effect.succeed(
  registerAutomationUnitHandler({
    kind: "condition",
    subject: Schema.Struct({}),
    fetch: () =>
      Effect.fail(new AutomationUnitDefect({ code: "kind-unimplemented" })),
    commit: () => Effect.succeed([]),
  })
);
