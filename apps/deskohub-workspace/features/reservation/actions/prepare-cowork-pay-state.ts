import { buildSignedPayState } from "@/features/checkout/backend/checkout";
import type {
  CheckoutSummaryChangedKeys,
  CoworkReservationQuote,
} from "@/features/checkout/checkout-quote";
import type { CheckoutDetailsJson } from "@/features/checkout/schemas/checkout-details";
import { getCoworkCheckoutDetails } from "@/features/checkout/schemas/checkout-details-cowork";
import type { Locale } from "@/features/i18n";
import type { WorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import type { NormalizedCoworkReservationOrder } from "@/features/reservation/cowork-reservation";

export type PreparedCoworkPayState = {
  readonly kind: "cowork";
  readonly reservation: NormalizedCoworkReservationOrder;
  readonly quote: CoworkReservationQuote;
};

export const ensureCoworkPayStateAvailable = (input: {
  readonly availability: typeof WorkspaceAvailabilityService.Service;
  readonly reservation: NormalizedCoworkReservationOrder;
}) =>
  input.availability.ensureAvailable({
    kind: input.reservation.kind,
    date: input.reservation.date,
    entryTier: input.reservation.entryTier,
    monitorOption: input.reservation.monitorOption,
  });

export const getPreparedCoworkCheckoutDetails = (input: {
  readonly locale: Locale;
  readonly prepared: PreparedCoworkPayState;
  readonly legalEvidence: CheckoutDetailsJson["legal"];
}): CheckoutDetailsJson =>
  getCoworkCheckoutDetails({
    locale: input.locale,
    reservation: input.prepared.reservation,
    quote: input.prepared.quote,
    legalEvidence: input.legalEvidence,
  });

export const buildPreparedCoworkPayState = (input: {
  readonly locale: Locale;
  readonly prepared: PreparedCoworkPayState;
  readonly reservationId: string;
  readonly checkoutSessionId: string;
  readonly changedKeys?: CheckoutSummaryChangedKeys;
}) =>
  buildSignedPayState({
    locale: input.locale,
    reservation: input.prepared.reservation,
    quote: input.prepared.quote,
    orderId: input.reservationId,
    checkoutSessionId: input.checkoutSessionId,
    changedKeys: input.changedKeys,
  });
