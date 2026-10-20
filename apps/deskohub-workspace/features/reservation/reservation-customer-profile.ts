import { Match } from "effect";
import type { CustomerProfileInput } from "@/features/account/contracts";
import type { InvoiceBuyerAddressInput } from "@/features/accounting/billing-identity";
import { splitCustomerName } from "@/features/checkout/backend/reservation";
import type { ReservationBillingSelection } from "./reservation-billing";

const toProfileAddress = (address: InvoiceBuyerAddressInput) => ({
  addressLine1: address.line1,
  ...(address.line2 && { addressLine2: address.line2 }),
  city: address.city,
  zip: address.postalCode,
  country: address.country,
});

/**
 * The first profile a checkout saves for an account that has none: the
 * contact typed at the contact-details step, with the billing details the
 * reservation asks an invoice for.
 */
export const getReservationCustomerProfile = (reservation: {
  readonly name: string;
  readonly phone: string;
  readonly billing?: ReservationBillingSelection;
}): CustomerProfileInput => {
  const billing = reservation.billing
    ? Match.value(reservation.billing).pipe(
        Match.when({ invoice: "none" }, () => undefined),
        Match.when({ invoice: "requested" }, ({ address }) => ({
          kind: "personal" as const,
          ...toProfileAddress(address),
        })),
        Match.when({ invoice: "required" }, ({ buyer }) => ({
          kind: "business" as const,
          companyName: buyer.legalName,
          companyId: buyer.companyId,
          ...(buyer.vatId && { vatId: buyer.vatId }),
          ...toProfileAddress(buyer.address),
        })),
        Match.exhaustive
      )
    : undefined;

  return {
    ...splitCustomerName(reservation.name),
    phone: reservation.phone,
    ...(billing && { billing }),
  };
};
