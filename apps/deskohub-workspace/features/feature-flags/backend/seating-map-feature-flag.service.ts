import "server-only";

import { Context, Effect, Layer } from "effect";
import { WorkspaceFeatureFlagService } from "./workspace-feature-flag.service";

export interface ISeatingMapFeatureFlagService {
  readonly isEnabled: Effect.Effect<boolean>;
}

export class SeatingMapFeatureFlagService extends Context.Service<
  SeatingMapFeatureFlagService,
  ISeatingMapFeatureFlagService
>()("@deskohub-workspace/feature-flags/SeatingMapFeatureFlagService") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const featureFlags = yield* WorkspaceFeatureFlagService;

      return {
        isEnabled: featureFlags
          .isEnabled("seating_map")
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning(error.message, { cause: error.cause }).pipe(
                Effect.as(false)
              )
            )
          ),
      } satisfies ISeatingMapFeatureFlagService;
    })
  );
}
