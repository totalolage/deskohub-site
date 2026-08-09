import { Match } from "effect";
import type { ReservationQuote } from "@/features/checkout/reservation-quote";
import type {
  CanonicalCoworkReservation,
  CoworkReservationPricingInput,
} from "@/features/checkout/reservation-quote-cowork";
import {
  type CanonicalMeetingRoomReservation,
  getCanonicalMeetingRoomReservation,
} from "@/features/checkout/reservation-quote-meeting-room";
import {
  type CanonicalOfficeReservation,
  getCanonicalOfficeReservation,
} from "@/features/checkout/reservation-quote-office";
import type { CoworkReservationDetails } from "@/features/reservation/cowork-reservation";
import type { MeetingRoomReservationPricingInput } from "@/features/reservation/meeting-room-reservation";
import type { OfficeReservationPricingInput } from "@/features/reservation/office-reservation";

type AppliedDiscount = ReservationQuote["payment"]["discounts"][number];
type CanonicalAppliedDiscount = {
  readonly discount: {
    readonly id: AppliedDiscount["discount"]["id"];
    readonly label: AppliedDiscount["discount"]["label"];
    readonly adjustment: AppliedDiscount["discount"]["adjustment"];
    readonly expiresAt: string | null;
    readonly countdownStartsAt: string | null;
  };
  readonly subtotalBefore: AppliedDiscount["subtotalBefore"];
  readonly amount: AppliedDiscount["amount"];
  readonly subtotalAfter: AppliedDiscount["subtotalAfter"];
};
type CanonicalReservation =
  | CanonicalCoworkReservation
  | CanonicalMeetingRoomReservation
  | CanonicalOfficeReservation;
type ReservationQuoteFingerprintReservation =
  | CoworkReservationDetails
  | CoworkReservationPricingInput
  | MeetingRoomReservationPricingInput
  | OfficeReservationPricingInput;

const getCanonicalAppliedDiscount = (
  application: AppliedDiscount
): CanonicalAppliedDiscount => ({
  discount: {
    id: application.discount.id,
    label: application.discount.label,
    adjustment: Match.value(application.discount.adjustment).pipe(
      Match.discriminatorsExhaustive("kind")({
        percentage: (adjustment) => ({
          kind: adjustment.kind,
          basisPoints: adjustment.basisPoints,
        }),
        fixed: (adjustment) => ({
          kind: adjustment.kind,
          amount: adjustment.amount,
        }),
      })
    ),
    expiresAt: application.discount.expiresAt ?? null,
    countdownStartsAt: application.discount.countdownStartsAt ?? null,
  },
  subtotalBefore: application.subtotalBefore,
  amount: application.amount,
  subtotalAfter: application.subtotalAfter,
});

const getCanonicalReservation = (
  reservation: ReservationQuoteFingerprintReservation
): CanonicalReservation =>
  Match.value(reservation).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: () => ({ kind: "cowork" as const }),
      "meeting-room": getCanonicalMeetingRoomReservation,
      office: getCanonicalOfficeReservation,
    })
  );

const hashCanonicalPayload = (canonicalPayload: string): string =>
  Array.from(canonicalPayload)
    .reduce(
      (hash, character) =>
        Math.imul(hash ^ character.charCodeAt(0), 0x01000193) >>> 0,
      0x811c9dc5
    )
    .toString(16);

export const getReservationQuoteFingerprint = (
  reservation: ReservationQuoteFingerprintReservation,
  quote: Omit<ReservationQuote, "fingerprint">
): string =>
  hashCanonicalPayload(
    JSON.stringify({
      reservation: getCanonicalReservation(reservation),
      items: quote.items,
      payment: {
        expectedPrice: quote.payment.expectedPrice,
        undiscountedPrice: quote.payment.undiscountedPrice,
        discounts: quote.payment.discounts.map(getCanonicalAppliedDiscount),
      },
    })
  );
