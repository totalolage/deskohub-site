import { parsePhoneNumber } from "@deskohub/phone-number";
import { Match, Option } from "effect";
import type { CustomerProfileSave } from "@/features/account/contracts";
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
 * reservation asks an invoice for. The phone is read in `defaultPhoneRegion`,
 * the region of the locale the contact was validated in.
 */
export const getReservationCustomerProfile = (
  reservation: {
    readonly name: string;
    readonly phone: string;
    readonly billing?: ReservationBillingSelection;
  },
  defaultPhoneRegion: string
): CustomerProfileSave => {
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
    phone: Option.getOrUndefined(
      parsePhoneNumber(reservation.phone, defaultPhoneRegion)
    ),
    ...(billing && { billing }),
  };
};
