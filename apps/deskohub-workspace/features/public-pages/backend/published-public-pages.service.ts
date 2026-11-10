import { Context, Effect, Layer } from "effect";
import type { ReleaseGateUnavailableError } from "@/features/feature-flags/backend/release-gate";
import { MeetingRoomPageReleaseGate } from "@/features/meeting-room/backend/meeting-room-page-release-gate";
import { OfficeReleaseGate } from "@/features/office/backend/office-release-gate";
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
   * page while its release gate is on. A gate PostHog can't decide fails, so
   * a stored page or sitemap keeps its last good version instead of
   * dropping the page.
   */
  readonly isPublished: (
    pathname: PublicPagePathname
  ) => Effect.Effect<boolean, ReleaseGateUnavailableError>;
  /** The public pages production serves now, in registry order. */
  readonly list: Effect.Effect<
    ReadonlyArray<PublicPage>,
    ReleaseGateUnavailableError
  >;
}

export class PublishedPublicPagesService extends Context.Service<
  PublishedPublicPagesService,
  IPublishedPublicPagesService
>()("@deskohub-workspace/public-pages/PublishedPublicPagesService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const meetingRoomPage = yield* MeetingRoomPageReleaseGate;
      const officePage = yield* OfficeReleaseGate;
      const releaseGates = {
        "meeting-room-page": meetingRoomPage.decision,
        "office-page": officePage.decision,
      } satisfies Record<
        PublicPageReleaseGate,
        Effect.Effect<boolean, ReleaseGateUnavailableError>
      >;

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
      Layer.mergeAll(MeetingRoomPageReleaseGate.Live, OfficeReleaseGate.Live)
    )
  );
}
