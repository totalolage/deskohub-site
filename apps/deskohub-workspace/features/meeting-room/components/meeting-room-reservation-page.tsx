import { Effect } from "effect";
import { CheckoutPricingService } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import type { CheckoutSessionId } from "@/features/checkout/checkout-identifiers";
import type { CanonicalPromotionCode } from "@/features/discounts";
import { type Locale, m } from "@/features/i18n";
import { loadAdvertisedPrices } from "@/features/reservation/backend/advertised-prices.server";
import { createReservationPage } from "@/features/reservation/components/create-reservation-page.server";
import { getMeetingRoomDurationAdvertisedPriceRequests } from "@/features/reservation/meeting-room-advertised-price";
import {
  getMeetingRoomReservationDefaultValues,
  type NormalizedMeetingRoomReservationOrder,
} from "@/features/reservation/meeting-room-reservation";
import { getMeetingRoomReservationDurationKey } from "@/features/reservation/meeting-room-reservation-duration";
import { getMeetingRoomReservationDefaultValuesFromSearchParams } from "@/features/reservation/reservation-checkout-query";
import { meetingRoomReservationPath } from "@/features/reservation/routes";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import type { SearchParamsRecord } from "@/shared/utils";
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
  searchParams,
  submittedCode,
}: {
  readonly checkoutSessionId?: CheckoutSessionId;
  readonly initialReservation?: NormalizedMeetingRoomReservationOrder;
  readonly locale: Locale;
  readonly replacementToken?: string;
  readonly searchParams: SearchParamsRecord;
  readonly submittedCode?: CanonicalPromotionCode;
}) {
  const restoredInitialValues = initialReservation
    ? getMeetingRoomReservationDefaultValues(initialReservation)
    : undefined;
  // The presence of a signed reservation decides the restored path even when
  // it has ended: the fallback must not consume public query values.
  const initialValues =
    restoredInitialValues ??
    (initialReservation
      ? getMeetingRoomReservationDefaultValuesFromSearchParams({})
      : getMeetingRoomReservationDefaultValuesFromSearchParams(searchParams));
  const initialAdvertisedPrices = await loadAdvertisedPrices(
    getMeetingRoomDurationAdvertisedPriceRequests({
      locale,
      startDateTime: initialValues.startDateTime,
      submittedCode,
    }).filter(
      ({ reservation }) =>
        getMeetingRoomReservationDurationKey(reservation.details.duration) ===
        initialValues.duration
    )
  ).pipe(
    Effect.provide(CheckoutPricingService.Live),
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
      submittedCode={submittedCode}
    />
  );
}
