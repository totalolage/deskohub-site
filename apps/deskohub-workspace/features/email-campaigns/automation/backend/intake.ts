import { Effect, Schema } from "effect";
import {
  AutomationUnitDefect,
  registerAutomationUnitHandler,
} from "./automation-unit-handler";

/** The `intake` unit: re-checks triggering visits live and starts runs for matched events (§5.6). */
export const makeIntakeHandler = Effect.succeed(
  registerAutomationUnitHandler({
    kind: "intake",
    subject: Schema.Struct({}),
    fetch: () =>
      Effect.fail(new AutomationUnitDefect({ code: "kind-unimplemented" })),
    commit: () => Effect.succeed([]),
  })
);
