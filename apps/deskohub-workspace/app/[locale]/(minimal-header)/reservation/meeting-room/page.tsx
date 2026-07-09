import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckoutOrderPage } from "@/features/checkout/components/checkout-order-page";
import { meetingRoomReservationPath } from "@/features/checkout/routes";
import { isLocale, locales, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import type { LocalizedRoutePageProps } from "@/features/i18n/server/route-params";
import {
  MeetingRoomReservationForm,
  MeetingRoomReservationFormFallback,
} from "@/features/reservation/components/meeting-room-reservation-form";
import {
  getWorkspaceLocalizedCanonicalUrl,
  workspaceSiteConstants,
} from "@/shared/utils";

export async function generateMetadata({
  params,
}: LocalizedRoutePageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return runWithRequestLocale(locale, () => {
    const title = m.reservationMeetingRoomMetadataTitle({}, { locale });
    const description = m.reservationMeetingRoomMetadataDescription(
      {},
      { locale }
    );
    const url = getWorkspaceLocalizedCanonicalUrl(
      locale,
      meetingRoomReservationPath
    );

    return {
      title,
      description,
      alternates: {
        canonical: url,
        languages: Object.fromEntries(
          locales.map((itemLocale) => [
            itemLocale,
            getWorkspaceLocalizedCanonicalUrl(
              itemLocale,
              meetingRoomReservationPath
            ),
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

export default async function LocalizedMeetingRoomReservationPage({
  params,
}: LocalizedRoutePageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return runWithRequestLocale(locale, () => (
    <CheckoutOrderPage
      fallback={
        <MeetingRoomReservationFormFallback locale={locale} showIntro={false} />
      }
      locale={locale}
    >
      <MeetingRoomReservationForm locale={locale} showIntro={false} />
    </CheckoutOrderPage>
  ));
}
