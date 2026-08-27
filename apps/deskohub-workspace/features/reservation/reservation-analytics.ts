const reservationAnalyticsUtmKeys = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

type ReservationAnalyticsUtmKey = (typeof reservationAnalyticsUtmKeys)[number];

export const reservationAvailabilityResults = [
  "available",
  "unavailable",
] as const;
export type ReservationAvailabilityResult =
  (typeof reservationAvailabilityResults)[number];

export const reservationPrePaymentOutcomes = [
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
