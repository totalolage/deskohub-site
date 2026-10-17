import type { Locale } from "@/features/i18n";
import type { AdministrationBookingSummary } from "./administration.service";
import { m } from "./i18n";

export const getAdministrationBookingStatusLabel = (
  status: AdministrationBookingSummary["status"],
  locale: Locale
) => {
  switch (status) {
    case "NEW":
      return m.administrationBookingStatusNew({}, { locale });
    case "CONFIRMED":
      return m.administrationBookingStatusConfirmed({}, { locale });
    case "CANCELLED":
      return m.administrationBookingStatusCancelled({}, { locale });
  }
};

/** The booking's party size, such as "4 guests". */
export const getAdministrationBookingGuestCount = (
  seats: AdministrationBookingSummary["seats"],
  locale: Locale
) => m.administrationBookingGuestCount({ count: Number(seats) }, { locale });
