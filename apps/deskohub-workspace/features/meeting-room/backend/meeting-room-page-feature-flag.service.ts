import { Context, Effect, Layer } from "effect";
import { WorkspaceFeatureFlagService } from "@/features/feature-flags/backend";

interface IMeetingRoomPageFeatureFlagService {
  readonly isEnabled: Effect.Effect<boolean>;
}

export class MeetingRoomPageFeatureFlagService extends Context.Service<
  MeetingRoomPageFeatureFlagService,
  IMeetingRoomPageFeatureFlagService
>()("@deskohub-workspace/meeting-room/MeetingRoomPageFeatureFlagService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const featureFlags = yield* WorkspaceFeatureFlagService;

      return {
        isEnabled: featureFlags.isEnabled("meeting_room_page").pipe(
          Effect.tapError((error) =>
            Effect.logWarning(error.message, { cause: error.cause })
          ),
          Effect.orElseSucceed(() => false)
        ),
      } satisfies IMeetingRoomPageFeatureFlagService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(WorkspaceFeatureFlagService.Default)
  );
}
