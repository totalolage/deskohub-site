import { Effect } from "effect";
import { isRememberedMeetingRoomReservationAvailable } from "@/features/reservation/backend/reservation-existing-customer.server";
import {
  createReservationPage,
  type ReservationPageRestoration,
} from "@/features/reservation/components/create-reservation-page.server";
import { getMeetingRoomDurationAdvertisedPriceRequests } from "@/features/reservation/meeting-room-advertised-price";
import {
  getMeetingRoomReservationDefaultValues,
  type MeetingRoomReservationInput,
} from "@/features/reservation/meeting-room-reservation";
import { meetingRoomSelectionLink } from "@/features/reservation/meeting-room-selection-link";
import { getMeetingRoomPageOfferings } from "@/features/reservation/reservation-page-offerings";
import { meetingRoomReservationPath } from "@/features/reservation/routes";
import { getMeetingRoomSelectionAvailabilityQuery } from "@/features/reservation/workspace-availability";
import {
  MeetingRoomReservationForm,
  MeetingRoomReservationFormFallback,
} from "./meeting-room-reservation-form";

export const meetingRoomReservationPage = createReservationPage({
  fallback: (locale) => <MeetingRoomReservationFormFallback locale={locale} />,
  kind: "meeting-room",
  pathname: meetingRoomReservationPath,
  prefillsContact: true,
  // An ended reservation can't reopen the form.
  restore: (
    reservation,
    searchParams,
    { locale }
  ): ReservationPageRestoration<MeetingRoomReservationInput> => {
    const values = getMeetingRoomReservationDefaultValues(reservation);
    return values
      ? {
          kind: "restored",
          values: meetingRoomSelectionLink.restore(values, searchParams, {
            locale,
          }),
        }
      : { kind: "ended" };
  },
  /**
   * Query values refined by the customer's last meeting-room duration, which
   * applies only while the room is free for it.
   */
  read: Effect.fn("meetingRoomReservationPage.read")(function* (
    searchParams,
    { lastReservation, locale }
  ) {
    const queryValues = meetingRoomSelectionLink.read(searchParams, {
      locale,
    });
    if (!lastReservation) return queryValues;

    const rememberedValues = meetingRoomSelectionLink.read(searchParams, {
      locale,
      lastReservation,
    });
    if (rememberedValues.duration === queryValues.duration) {
      return queryValues;
    }

    return (yield* isRememberedMeetingRoomReservationAvailable(
      rememberedValues
    ))
      ? rememberedValues
      : queryValues;
  }),
  preload: (values, { locale, submittedCode }) => {
    const availabilityQuery = getMeetingRoomSelectionAvailabilityQuery(values);
    return {
      advertisedPrices: getMeetingRoomDurationAdvertisedPriceRequests({
        locale,
        startDateTime: values.startDateTime,
        submittedCode,
      }),
      availability: availabilityQuery ? [availabilityQuery] : [],
    };
  },
  offerings: (values, advertisedPrices, { locale, submittedCode }) =>
    getMeetingRoomPageOfferings({
      advertisedPrices,
      locale,
      startDateTime: values.startDateTime,
      submittedCode,
    }),
  renderForm: (form) => (
    <MeetingRoomReservationForm
      checkoutCustomer={form.checkoutCustomer}
      checkoutSessionId={form.checkoutSessionId}
      initialAdvertisedPrices={form.initialAdvertisedPrices}
      initialAvailability={form.initialAvailability}
      initialValues={form.initialValues}
      locale={form.locale}
      replacementToken={form.replacementToken}
      submittedCode={form.submittedCode}
    />
  ),
});
