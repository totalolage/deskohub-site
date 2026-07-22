import { Effect, Option } from "effect";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WorkspaceFeatureFlagServiceLive } from "@/features/feature-flags/backend/workspace-feature-flag.server";
import {
  type CloudinaryAsset,
  CloudinaryServiceLive,
} from "@/features/gallery/backend/cloudinary.service";
import { getCloudinaryImages } from "@/features/gallery/backend/cloudinary-images";
import { locales, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { getParamsDecoder } from "@/features/i18n/server/route-params";
import { isMeetingRoomPageEnabled } from "@/features/meeting-room/backend/meeting-room-page-feature-flag";
import { MeetingRoomEditorialDesign } from "@/features/meeting-room/components/meeting-room-editorial-design";
import { MeetingRoomPageFeature } from "@/features/meeting-room/components/meeting-room-page-feature";
import { WorkspaceEffect } from "@/shared/backend/workspace-effect";
import {
  getWorkspaceLocalizedCanonicalUrl,
  workspaceSiteConstants,
} from "@/shared/utils";

type MeetingRoomPageProps = {
  params: Promise<{ locale: string }>;
};

const pathname = "/meeting-room";
const decodeMeetingRoomParams = getParamsDecoder({});

const getMeetingRoomImages = () =>
  getCloudinaryImages({
    tags: [["ttrpg-room", "ttrpg-room-workspace"]],
  }).pipe(
    Effect.provide(CloudinaryServiceLive),
    Effect.catch(() => Effect.succeed([] as readonly CloudinaryAsset[]))
  );

export const generateMetadata = WorkspaceEffect.page(
  {
    operation: "meeting-room.metadata",
    layer: WorkspaceFeatureFlagServiceLive,
  },
  ({ params }: MeetingRoomPageProps) =>
    Effect.gen(function* () {
      const routeParams = Option.getOrUndefined(
        decodeMeetingRoomParams(yield* Effect.promise(() => params))
      );
      if (!routeParams) return yield* Effect.sync(() => notFound());
      const { locale } = routeParams;
      if (!(yield* isMeetingRoomPageEnabled)) {
        return yield* Effect.sync(() => notFound());
      }

      return runWithRequestLocale(locale, () => {
        const title = m.meetingRoomMetadataTitle({}, { locale });
        const description = m.meetingRoomMetadataDescription({}, { locale });
        const url = getWorkspaceLocalizedCanonicalUrl(locale, pathname);

        return {
          title,
          description,
          alternates: {
            canonical: url,
            languages: Object.fromEntries(
              locales.map((itemLocale) => [
                itemLocale,
                getWorkspaceLocalizedCanonicalUrl(itemLocale, pathname),
              ])
            ),
          },
          openGraph: {
            title,
            description,
            url,
            siteName: workspaceSiteConstants.brand.name,
            locale,
            type: "website",
          },
        } satisfies Metadata;
      });
    })
);

export default WorkspaceEffect.page(
  {
    operation: "meeting-room.render",
    layer: WorkspaceFeatureFlagServiceLive,
  },
  ({ params }: MeetingRoomPageProps) =>
    Effect.gen(function* () {
      const routeParams = Option.getOrUndefined(
        decodeMeetingRoomParams(yield* Effect.promise(() => params))
      );
      if (!routeParams) return yield* Effect.sync(() => notFound());
      const { locale } = routeParams;
      const meetingRoomPageEnabled = yield* isMeetingRoomPageEnabled;
      if (!meetingRoomPageEnabled) {
        return yield* Effect.sync(() => notFound());
      }
      const images = yield* getMeetingRoomImages();

      return runWithRequestLocale(locale, () => (
        <MeetingRoomPageFeature initialEnabled={meetingRoomPageEnabled}>
          <MeetingRoomEditorialDesign images={images} locale={locale} />
        </MeetingRoomPageFeature>
      ));
    })
);
