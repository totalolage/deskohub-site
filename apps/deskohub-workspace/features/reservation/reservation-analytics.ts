const reservationAnalyticsUtmKeys = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

type ReservationAnalyticsUtmKey = (typeof reservationAnalyticsUtmKeys)[number];

const reservationAvailabilityResults = ["available", "unavailable"] as const;
export type ReservationAvailabilityResult =
  (typeof reservationAvailabilityResults)[number];

const reservationPrePaymentOutcomes = [
  "validation",
  "availability_changed",
  "pricing_changed",
  "discount_rejected",
  "reservation_conflict",
  "server_error",
  "transport_error",
  "prepared",
] as const;
export type ReservationPrePaymentOutcome =
  (typeof reservationPrePaymentOutcomes)[number];

/**
 * The consented browser saw the status page show a status; its only property
 * is `status`, the page's `CheckoutStatusKind`.
 */
export const CHECKOUT_STATUS_VIEWED_EVENT = "checkout status viewed";

export type ReservationAnalyticsProperties = Partial<
  Record<ReservationAnalyticsUtmKey, string>
>;

export const getReservationAnalyticsProperties = (
  searchParams: URLSearchParams
): ReservationAnalyticsProperties => {
  const properties: ReservationAnalyticsProperties = {};

  for (const key of reservationAnalyticsUtmKeys) {
    const value = searchParams.get(key)?.trim();
    if (value) properties[key] = value.slice(0, 128);
  }

  return properties;
};
