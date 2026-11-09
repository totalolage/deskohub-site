import type {
  CustomerAvailability,
  CustomerReservationFamily,
} from "@deskohub/workspace-customer-api";
import { Match } from "effect";
import { sharedViewErrorMessage } from "../../customer-api/customer-view-error-message";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import type { CheckoutRestartReason } from "../checkout/booking-problem";
import type { BookingQueryViewError } from "../data/booking-query-error";

export const familyTitle = (
  family: CustomerReservationFamily,
  locale: AppLocale
) =>
  ({
    cowork: m.booking_family_cowork_title,
    "meeting-room": m.booking_family_meeting_room_title,
    office: m.booking_family_office_title,
  })[family]({}, { locale });

export const familyDescription = (
  family: CustomerReservationFamily,
  locale: AppLocale
) =>
  ({
    cowork: m.booking_family_cowork_description,
    "meeting-room": m.booking_family_meeting_room_description,
    office: m.booking_family_office_description,
  })[family]({}, { locale });

/** The sentence for a failed booking catalog read. */
export const bookingQueryMessage = (
  error: BookingQueryViewError,
  locale: AppLocale
): string =>
  Match.value(error).pipe(
    Match.tag("SelectionInvalid", () =>
      m.booking_error_selection_invalid({}, { locale })
    ),
    Match.tag("DateOutOfRange", () =>
      m.booking_error_date_out_of_range({}, { locale })
    ),
    Match.tag("OfferingUnavailable", () =>
      m.booking_error_offering_unavailable({}, { locale })
    ),
    Match.orElse(
      (shared) =>
        sharedViewErrorMessage(shared, locale) ??
        m.account_error_unexpected({}, { locale })
    )
  );

/** Why the booking started over, one sentence per group of reasons. */
export const restartMessage = (
  reason: CheckoutRestartReason,
  locale: AppLocale
) =>
  ({
    hold_expired: m.booking_restart_hold_expired,
    availability_changed: m.booking_restart_availability_changed,
    checkout_conflict: m.booking_restart_availability_changed,
    reservation_ended: m.booking_restart_availability_changed,
    quote_expired: m.booking_restart_price_changed,
    offer_replaced: m.booking_restart_price_changed,
    selection_invalid: m.booking_restart_selection_unavailable,
    date_out_of_range: m.booking_restart_selection_unavailable,
    offering_unavailable: m.booking_restart_selection_unavailable,
    checkout_not_found: m.booking_restart_checkout_not_found,
  })[reason]({}, { locale });

const pragueTime = (locale: AppLocale) =>
  new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Prague",
  });

/** A Google Calendar limitation on a booked day, as a sentence. */
export const availabilityNoticeMessage = (
  { startsAt, endsAt, summary }: CustomerAvailability["notices"][number],
  locale: AppLocale
) => {
  const format = pragueTime(locale);
  const times = {
    start: format.format(new Date(startsAt)),
    end: format.format(new Date(endsAt)),
  };
  return summary === undefined
    ? m.booking_calendar_notice({ ...times }, { locale })
    : m.booking_calendar_notice_with_summary({ ...times, summary }, { locale });
};
