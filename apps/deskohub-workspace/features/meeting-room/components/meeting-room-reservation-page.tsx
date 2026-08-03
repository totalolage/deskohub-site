import { Effect } from "effect";
import { CheckoutPricingServiceLiveWithDependencies } from "@/features/checkout/backend/checkout/checkout-pricing.runtime";
import { type Locale, m } from "@/features/i18n";
import { loadInitialAdvertisedPrices } from "@/features/reservation/backend/initial-advertised-prices.server";
import { createReservationPage } from "@/features/reservation/components/create-reservation-page.server";
import { getMeetingRoomDurationAdvertisedPriceRequests } from "@/features/reservation/meeting-room-advertised-price";
import {
  getMeetingRoomReservationDefaultValues,
  meetingRoomReservationDefaultValues,
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
  kind: "meeting-room",
  pathname: meetingRoomReservationPath,
  metadata: (locale: Locale) => ({
    title: m.reservationMeetingRoomMetadataTitle({}, { locale }),
    description: m.reservationMeetingRoomMetadataDescription({}, { locale }),
  }),
  render: async ({ checkoutSessionId, initialReservation, locale }) => {
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
    const initialAdvertisedPrices = await loadInitialAdvertisedPrices(
      getMeetingRoomDurationAdvertisedPriceRequests({
        locale,
        startDateTime: initialValues.startDateTime,
      }).map(({ request }) => request)
    ).pipe(
      Effect.provide(CheckoutPricingServiceLiveWithDependencies),
      Effect.scoped,
      runWorkspaceEffect("reservation.meeting-room.load-advertised-prices")
    );

    return {
      fallback: <MeetingRoomReservationFormFallback locale={locale} />,
      children: (
        <MeetingRoomReservationForm
          checkoutSessionId={checkoutSessionId}
          initialAdvertisedPrices={initialAdvertisedPrices}
          initialReservation={
            restoredInitialValues ? initialReservation : undefined
          }
          initialValues={initialValues}
          locale={locale}
        />
      ),
    };
  },
});
