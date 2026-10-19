import { Context, Effect, Layer } from "effect";
import type { AutomationWorkUnitKind } from "../automation-work-units";
import type { RegisteredAutomationUnitHandler } from "./automation-unit-handler";

interface IAutomationUnitHandlers {
  readonly byKind: ReadonlyMap<
    AutomationWorkUnitKind,
    RegisteredAutomationUnitHandler
  >;
  /**
   * The kinds this deployment claims, promotes and reaps. A unit of any
   * other kind waits for a deployment that supports it (§9.1).
   */
  readonly supportedKinds: ReadonlyArray<AutomationWorkUnitKind>;
}

/** The unit kinds this deployment runs. */
export class AutomationUnitHandlers extends Context.Service<
  AutomationUnitHandlers,
  IAutomationUnitHandlers
>()("@deskohub-workspace/email-campaigns/AutomationUnitHandlers") {
  static layer = <R>(
    handlers: Effect.Effect<
      ReadonlyArray<RegisteredAutomationUnitHandler>,
      never,
      R
    >
  ) =>
    Layer.effect(
      this,
      Effect.map(handlers, (registered) => ({
        byKind: new Map(registered.map((handler) => [handler.kind, handler])),
        supportedKinds: registered.map((handler) => handler.kind),
      }))
    );

  static Live = this.layer(Effect.succeed([]));
}
