import type { CheckoutSessionId } from "@/features/checkout/checkout-identifiers";
import type { CanonicalPromotionCode } from "@/features/discounts";
import { type Locale, m } from "@/features/i18n";
import { preloadPageAdvertisedPrices } from "@/features/reservation/backend/advertised-prices.server";
import { isRememberedMeetingRoomReservationAvailable } from "@/features/reservation/backend/reservation-existing-customer.server";
import { preloadPageAvailability } from "@/features/reservation/backend/workspace-availability-loader";
import { createReservationPage } from "@/features/reservation/components/create-reservation-page.server";
import { ReservationOfferingsStructuredData } from "@/features/reservation/components/reservation-offerings-structured-data";
import { getMeetingRoomDurationAdvertisedPriceRequests } from "@/features/reservation/meeting-room-advertised-price";
import type { NormalizedMeetingRoomReservationOrder } from "@/features/reservation/meeting-room-reservation";
import {
  getMeetingRoomReservationDefaultValuesFromSearchParams,
  getMeetingRoomRestoredReservationValues,
} from "@/features/reservation/meeting-room-reservation-checkout-query";
import type { ReservationCheckoutContact } from "@/features/reservation/reservation-checkout-contact";
import { getReservationCustomerQueryMode } from "@/features/reservation/reservation-checkout-query";
import {
  type CustomerLastReservationForKind,
  getCheckoutAccountLastReservation,
  getReservationCheckoutCustomerForm,
  type ReservationCheckoutAccount,
} from "@/features/reservation/reservation-existing-customer";
import { getMeetingRoomPageOfferings } from "@/features/reservation/reservation-page-offerings";
import { meetingRoomReservationPath } from "@/features/reservation/routes";
import { getMeetingRoomSelectionAvailabilityQuery } from "@/features/reservation/workspace-availability";
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

/**
 * Query values refined by the customer's last meeting-room duration, which
 * applies only while the room is free for it.
 */
const getMeetingRoomQueryValues = async (
  searchParams: SearchParamsRecord,
  lastReservation: CustomerLastReservationForKind<"meeting-room"> | undefined
) => {
  const queryValues =
    getMeetingRoomReservationDefaultValuesFromSearchParams(searchParams);
  if (!lastReservation) return queryValues;

  const rememberedValues =
    getMeetingRoomReservationDefaultValuesFromSearchParams(
      searchParams,
      undefined,
      lastReservation
    );
  if (rememberedValues.duration === queryValues.duration) return queryValues;

  return (await isRememberedMeetingRoomReservationAvailable(rememberedValues))
    ? rememberedValues
    : queryValues;
};

export async function renderMeetingRoomReservationContent({
  checkoutSessionId,
  checkoutAccount,
  checkoutContact,
  initialReservation,
  locale,
  replacementToken,
  searchParams,
  submittedCode,
}: {
  readonly checkoutSessionId?: CheckoutSessionId;
  readonly checkoutAccount: ReservationCheckoutAccount<"meeting-room">;
  readonly checkoutContact?: ReservationCheckoutContact;
  readonly initialReservation?: NormalizedMeetingRoomReservationOrder;
  readonly locale: Locale;
  readonly replacementToken?: string;
  readonly searchParams: SearchParamsRecord;
  readonly submittedCode?: CanonicalPromotionCode;
}) {
  const restoredInitialValues = initialReservation
    ? getMeetingRoomRestoredReservationValues(initialReservation, searchParams)
    : undefined;
  // The presence of a signed reservation decides the restored path even when
  // it has ended: the fallback must not consume public query values.
  const restoredOrQueryValues =
    restoredInitialValues ??
    (await getMeetingRoomQueryValues(
      initialReservation ? {} : searchParams,
      getCheckoutAccountLastReservation(checkoutAccount)
    ));
  const { checkoutCustomer, initialValues } =
    getReservationCheckoutCustomerForm({
      account: checkoutAccount,
      checkoutContact,
      queryMode: initialReservation
        ? undefined
        : getReservationCustomerQueryMode(searchParams),
      restored: Boolean(restoredInitialValues),
      values: restoredOrQueryValues,
    });
  const initialAvailabilityQuery =
    getMeetingRoomSelectionAvailabilityQuery(initialValues);
  const [initialAdvertisedPrices, initialAvailability] = await Promise.all([
    preloadPageAdvertisedPrices(
      getMeetingRoomDurationAdvertisedPriceRequests({
        locale,
        startDateTime: initialValues.startDateTime,
        submittedCode,
      })
    ).pipe(
      runWorkspaceEffect("reservation.meeting-room.load-advertised-prices")
    ),
    preloadPageAvailability({
      queries: initialAvailabilityQuery ? [initialAvailabilityQuery] : [],
      replacementToken,
    }).pipe(
      runWorkspaceEffect("reservation.meeting-room.preload-availability")
    ),
  ]);

  return (
    <>
      <ReservationOfferingsStructuredData
        locale={locale}
        offerings={getMeetingRoomPageOfferings({
          advertisedPrices: initialAdvertisedPrices,
          locale,
          startDateTime: initialValues.startDateTime,
          submittedCode,
        })}
        pathname={meetingRoomReservationPath}
      />
      <MeetingRoomReservationForm
        checkoutSessionId={checkoutSessionId}
        checkoutCustomer={checkoutCustomer}
        initialAdvertisedPrices={initialAdvertisedPrices}
        initialAvailability={initialAvailability}
        initialReservation={
          restoredInitialValues ? initialReservation : undefined
        }
        initialValues={initialValues}
        locale={locale}
        replacementToken={replacementToken}
        submittedCode={submittedCode}
      />
    </>
  );
}
