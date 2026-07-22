import { Option } from "effect";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCloudinaryImages } from "@/features/gallery/actions/get-cloudinary-images";
import type { CloudinaryAsset } from "@/features/gallery/backend/cloudinary.service";
import { locales, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { getParamsDecoder } from "@/features/i18n/server/route-params";
import { isMeetingRoomPageEnabled } from "@/features/meeting-room/backend/meeting-room-page-feature-flag";
import { MeetingRoomEditorialDesign } from "@/features/meeting-room/components/meeting-room-editorial-design";
import { MeetingRoomPageFeature } from "@/features/meeting-room/components/meeting-room-page-feature";
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
  }).catch((): readonly CloudinaryAsset[] => []);

export async function generateMetadata({
  params,
}: MeetingRoomPageProps): Promise<Metadata> {
  const routeParams = Option.getOrUndefined(
    decodeMeetingRoomParams(await params)
  );
  if (!routeParams) notFound();
  const { locale } = routeParams;
  if (!(await isMeetingRoomPageEnabled())) notFound();

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
}

export default async function LocalizedMeetingRoomPage({
  params,
}: MeetingRoomPageProps) {
  const routeParams = Option.getOrUndefined(
    decodeMeetingRoomParams(await params)
  );
  if (!routeParams) notFound();
  const { locale } = routeParams;
  const meetingRoomPageEnabled = await isMeetingRoomPageEnabled();
  if (!meetingRoomPageEnabled) notFound();
  const images = await getMeetingRoomImages();

  return runWithRequestLocale(locale, () => (
    <MeetingRoomPageFeature initialEnabled={meetingRoomPageEnabled}>
      <MeetingRoomEditorialDesign images={images} locale={locale} />
    </MeetingRoomPageFeature>
  ));
}
