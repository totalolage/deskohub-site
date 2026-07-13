import { Effect, Option } from "effect";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  openPayState,
  payStateTokenQueryParam,
} from "@/features/checkout/backend/checkout";
import { CheckoutOrderPage } from "@/features/checkout/components/checkout-order-page";
import { isLocale, type Locale, locales, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import {
  MeetingRoomReservationForm,
  MeetingRoomReservationFormFallback,
} from "@/features/reservation/components/meeting-room-reservation-form";
import { meetingRoomReservationPath } from "@/features/reservation/routes";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import {
  getSearchParam,
  getWorkspaceLocalizedCanonicalUrl,
  type SearchParamsRecord,
  workspaceSiteConstants,
} from "@/shared/utils";

type LocalizedMeetingRoomReservationPageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParamsRecord>;
};

const getOrderPayState = Effect.fn("meetingRoomReservation.getPayState")(
  function* (token: string | undefined, locale: Locale) {
    if (!token) return undefined;

    const state = yield* openPayState(token).pipe(Effect.option);
    return Option.getOrUndefined(
      Option.filter(state, (payState) => payState.locale === locale)
    );
  }
);

export async function generateMetadata({
  params,
}: LocalizedMeetingRoomReservationPageProps): Promise<Metadata> {
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
  searchParams,
}: LocalizedMeetingRoomReservationPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const payState = await getOrderPayState(
    getSearchParam(await searchParams, payStateTokenQueryParam),
    locale
  ).pipe(runWorkspaceEffect("reservation.meeting-room.load-state"));
  const initialReservation =
    payState?.reservation.kind === "meeting-room"
      ? payState.reservation
      : undefined;
  const initialCheckoutSessionId = initialReservation
    ? payState?.checkoutSessionId
    : undefined;

  return runWithRequestLocale(locale, () => (
    <CheckoutOrderPage
      fallback={<MeetingRoomReservationFormFallback locale={locale} />}
      locale={locale}
    >
      <MeetingRoomReservationForm
        checkoutSessionId={initialCheckoutSessionId}
        initialReservation={initialReservation}
        locale={locale}
      />
    </CheckoutOrderPage>
  ));
}
