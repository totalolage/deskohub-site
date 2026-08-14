import { Context, Data, Effect, Layer } from "effect";
import { WorkspaceFeatureFlagService } from "@/features/feature-flags/backend";

export interface IOfficeReservationFeatureFlagService {
  readonly isEnabled: Effect.Effect<boolean>;
}

export class OfficeReservationFeatureFlagService extends Context.Service<
  OfficeReservationFeatureFlagService,
  IOfficeReservationFeatureFlagService
>()("@deskohub-workspace/office/OfficeReservationFeatureFlagService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const featureFlags = yield* WorkspaceFeatureFlagService;

      return {
        isEnabled: featureFlags.isEnabled("office_page").pipe(
          Effect.tapError((error) =>
            Effect.logWarning(error.message, { cause: error.cause })
          ),
          Effect.orElseSucceed(() => false)
        ),
      } satisfies IOfficeReservationFeatureFlagService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(WorkspaceFeatureFlagService.Default)
  );
}

export class OfficeReservationsDisabledError extends Data.TaggedError(
  "OfficeReservationsDisabledError"
)<{
  readonly message: string;
}> {}

export const ensureOfficeReservationsEnabled = Effect.gen(function* () {
  const featureFlag = yield* OfficeReservationFeatureFlagService;
  if (!(yield* featureFlag.isEnabled)) {
    return yield* new OfficeReservationsDisabledError({
      message: "Office reservations are disabled.",
    });
  }
});
