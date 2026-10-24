import { Context, Effect, Layer } from "effect";
import { MeetingRoomPageFeatureFlagService } from "@/features/meeting-room/backend/meeting-room-page-feature-flag.service";
import { OfficeReservationFeatureFlagService } from "@/features/office/backend/office-reservation-feature-flag.service";
import {
  type PublicPage,
  type PublicPageReleaseGate,
  publicPageDefinitions,
  publicPages,
} from "../public-page-definitions";
import type { PublicPagePathname } from "../public-pages";

interface IPublishedPublicPagesService {
  /**
   * Whether production serves the page now: an ungated page always, a gated
   * page while its release gate is on. A gate that can't be evaluated fails
   * closed.
   */
  readonly isPublished: (
    pathname: PublicPagePathname
  ) => Effect.Effect<boolean>;
  /** The public pages production serves now, in registry order. */
  readonly list: Effect.Effect<ReadonlyArray<PublicPage>>;
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

      const isPublished = (pathname: PublicPagePathname) => {
        const { releaseGate } = publicPageDefinitions[pathname];
        return releaseGate === undefined
          ? Effect.succeed(true)
          : releaseGates[releaseGate];
      };

      return {
        isPublished,
        list: Effect.filter(
          publicPages,
          ({ pathname }: PublicPage) => isPublished(pathname),
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
