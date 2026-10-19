import { Context, Effect, Layer } from "effect";
import { MeetingRoomPageFeatureFlagService } from "@/features/meeting-room/backend/meeting-room-page-feature-flag.service";
import { OfficeReservationFeatureFlagService } from "@/features/office/backend/office-reservation-feature-flag.service";
import {
  type PublicPage,
  type PublicPageReleaseGate,
  publicPages,
  type RegisteredPublicPage,
} from "../public-pages";

interface IPublishedPublicPagesService {
  /**
   * Public pages production serves now: every ungated page, plus each gated
   * page whose release gate is on. A gate that can't be evaluated fails
   * closed, so its page is left out.
   */
  readonly list: Effect.Effect<ReadonlyArray<RegisteredPublicPage>>;
}

export class PublishedPublicPagesService extends Context.Service<
  PublishedPublicPagesService,
  IPublishedPublicPagesService
>()("@deskohub-workspace/public-pages/PublishedPublicPagesService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const meetingRoomPage = yield* MeetingRoomPageFeatureFlagService;
      const officePage = yield* OfficeReservationFeatureFlagService;
      const releaseGates = {
        "meeting-room-page": meetingRoomPage.isEnabled,
        "office-page": officePage.isEnabled,
      } satisfies Record<PublicPageReleaseGate, Effect.Effect<boolean>>;

      return {
        list: Effect.filter(
          publicPages,
          ({ releaseGate }: PublicPage) =>
            releaseGate === undefined
              ? Effect.succeed(true)
              : releaseGates[releaseGate],
          { concurrency: "inherit" }
        ),
      } satisfies IPublishedPublicPagesService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        MeetingRoomPageFeatureFlagService.Live,
        OfficeReservationFeatureFlagService.Live
      )
    )
  );
}
