import { Effect } from "effect";
import { CheckoutPricingServiceLiveWithDependencies } from "@/features/checkout/backend/checkout/checkout-pricing.runtime";
import { type Locale, m } from "@/features/i18n";
import { loadAdvertisedPrices } from "@/features/reservation/backend/advertised-prices.server";
import { createReservationPage } from "@/features/reservation/components/create-reservation-page.server";
import { getMeetingRoomDurationAdvertisedPriceRequests } from "@/features/reservation/meeting-room-advertised-price";
import {
  getMeetingRoomReservationDefaultValues,
  meetingRoomReservationDefaultValues,
  type NormalizedMeetingRoomReservationOrder,
} from "@/features/reservation/meeting-room-reservation";
import { getMeetingRoomReservationDuration } from "@/features/reservation/meeting-room-reservation-duration";
import { getEarliestMeetingRoomStartDateTime } from "@/features/reservation/meeting-room-reservation-time";
import { meetingRoomReservationPath } from "@/features/reservation/routes";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import {
  MeetingRoomReservationForm,
  MeetingRoomReservationFormFallback,
} from "./meeting-room-reservation-form";

export const meetingRoomReservationPage = createReservationPage({
  fallback: (locale) => <MeetingRoomReservationFormFallback locale={locale} />,
  kind: "meeting-room",
  pathname: meetingRoomReservationPath,
  metadata: (locale: Locale) => ({
    title: m.reservationMeetingRoomMetadataTitle({}, { locale }),
    description: m.reservationMeetingRoomMetadataDescription({}, { locale }),
  }),
  render: renderMeetingRoomReservationContent,
});

export async function renderMeetingRoomReservationContent({
  checkoutSessionId,
  initialReservation,
  locale,
  replacementToken,
}: {
  readonly checkoutSessionId?: string;
  readonly initialReservation?: NormalizedMeetingRoomReservationOrder;
  readonly locale: Locale;
  readonly replacementToken?: string;
}) {
  const minimumStartDateTime = getEarliestMeetingRoomStartDateTime(
    getMeetingRoomReservationDuration(
      meetingRoomReservationDefaultValues.duration
    )
  );
  const restoredInitialValues = initialReservation
    ? getMeetingRoomReservationDefaultValues(initialReservation)
    : undefined;
  const initialValues = restoredInitialValues ?? {
    ...meetingRoomReservationDefaultValues,
    startDateTime: minimumStartDateTime,
  };
  const initialAdvertisedPrices = await loadAdvertisedPrices(
    getMeetingRoomDurationAdvertisedPriceRequests({
      locale,
      startDateTime: initialValues.startDateTime,
    }).map(({ request }) => request)
  ).pipe(
    Effect.provide(CheckoutPricingServiceLiveWithDependencies),
    Effect.scoped,
    runWorkspaceEffect("reservation.meeting-room.load-advertised-prices")
  );

  return (
    <MeetingRoomReservationForm
      checkoutSessionId={checkoutSessionId}
      initialAdvertisedPrices={initialAdvertisedPrices}
      initialReservation={
        restoredInitialValues ? initialReservation : undefined
      }
      initialValues={initialValues}
      locale={locale}
      replacementToken={replacementToken}
    />
  );
}
