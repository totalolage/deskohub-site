import "server-only";

import { Context, Effect, Layer } from "effect";
import { nodeFeatureFlags } from "./node";
import { getCurrentPostHogFeatureFlagSubject } from "./subject";

export interface ISeatingMapFeatureFlagService {
  readonly isEnabled: () => Effect.Effect<boolean>;
}

export class SeatingMapFeatureFlagService extends Context.Service<
  SeatingMapFeatureFlagService,
  ISeatingMapFeatureFlagService
>()("@deskohub-workspace/feature-flags/SeatingMapFeatureFlagService") {
  static Live = Layer.succeed(this, {
    isEnabled: Effect.fn("SeatingMapFeatureFlagService.isEnabled")(() =>
      Effect.Do.pipe(
        Effect.bind("subject", getCurrentPostHogFeatureFlagSubject),
        Effect.bind("enabled", ({ subject }) =>
          nodeFeatureFlags.isEnabled({ key: "seating_map", subject })
        ),
        Effect.map(({ enabled }) => enabled),
        Effect.catch((error) =>
          Effect.logWarning(error.message, { cause: error.cause }).pipe(
            Effect.as(false)
          )
        )
      )
    ),
  });
}
