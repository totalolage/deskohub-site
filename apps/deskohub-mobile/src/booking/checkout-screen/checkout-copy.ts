import type { CustomerBookingSelection } from "@deskohub/workspace-customer-api";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import type { CheckoutRetryKind } from "../checkout/booking-problem";
import type { SummaryLineView } from "../ui/price-summary";

/** What went wrong that the customer can retry, as one sentence. */
export const retryMessage = (kind: CheckoutRetryKind, locale: AppLocale) =>
  ({
    service_unavailable: () =>
      m.booking_checkout_retry_service_unavailable({}, { locale }),
    connection: () => m.booking_checkout_retry_connection({}, { locale }),
    rate_limited: () => m.booking_checkout_retry_rate_limited({}, { locale }),
    session_required: () =>
      m.booking_checkout_retry_session_required({}, { locale }),
    payment_browser: () =>
      m.booking_checkout_retry_payment_browser({}, { locale }),
    unexpected: () => m.booking_checkout_retry_unexpected({}, { locale }),
  })[kind]();

/** The booked product's name, as the site's summary names it. */
export const productLabel = (
  selection: CustomerBookingSelection,
  locale: AppLocale
) => {
  switch (selection.family) {
    case "cowork":
      return selection.tier === "reserved-desk"
        ? m.booking_checkout_line_reserved_desk({}, { locale })
        : m.booking_checkout_line_open_space({}, { locale });
    case "meeting-room":
      return m.booking_checkout_line_meeting_room({}, { locale });
    case "office":
      return m.booking_checkout_line_office({}, { locale });
  }
};

/**
 * A summary line's name. The product line's key encodes the product the
 * server priced, which is the booked selection's, so it's named from that.
 */
export const summaryLineLabel =
  (selection: CustomerBookingSelection, locale: AppLocale) =>
  (line: SummaryLineView): string => {
    const { kind } = line;
    switch (kind._tag) {
      case "Product":
        return productLabel(selection, locale);
      case "Coffee":
        return m.booking_checkout_line_coffee({}, { locale });
      case "Workstation":
        return m.booking_checkout_line_workstation({}, { locale });
      case "Monitor":
        return m.booking_checkout_line_monitor({}, { locale });
      case "Other":
        return m.booking_checkout_line_other({}, { locale });
    }
  };
