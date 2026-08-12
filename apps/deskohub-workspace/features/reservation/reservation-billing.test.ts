import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  getDotyposCustomerBillingDetails,
  getReservationInvoiceBuyer,
  reservationBillingSelectionSchema,
} from "./reservation-billing";

const decodeBilling = Schema.decodeUnknownSync(
  reservationBillingSelectionSchema
);

const address = {
  line1: "Synthetic street 1",
  city: "Prague",
  postalCode: "100 00",
  country: "CZ",
};

describe("reservation billing", () => {
  test("accepts only the three supported purpose and invoice combinations", () => {
    expect(decodeBilling({ purpose: "personal", invoice: "none" })).toEqual({
      purpose: "personal",
      invoice: "none",
    });
    expect(
      decodeBilling({ purpose: "personal", invoice: "requested", address })
    ).toMatchObject({ purpose: "personal", invoice: "requested", address });
    expect(
      decodeBilling({
        purpose: "business",
        invoice: "required",
        buyer: {
          kind: "business",
          legalName: "Synthetic Company s.r.o.",
          companyId: "12345678",
          address,
        },
      })
    ).toMatchObject({ purpose: "business", invoice: "required" });

    expect(() =>
      decodeBilling({ purpose: "business", invoice: "none" })
    ).toThrow();
    expect(() =>
      decodeBilling({ purpose: "personal", invoice: "requested" })
    ).toThrow();
    expect(() =>
      decodeBilling({
        purpose: "business",
        invoice: "required",
        buyer: { kind: "business", legalName: "Incomplete" },
      })
    ).toThrow();
  });

  test("uses the reservation name for personal invoices and maps Dotypos fields", () => {
    const billing = decodeBilling({
      purpose: "personal",
      invoice: "requested",
      address: { ...address, line2: "Unit 2" },
    });

    expect(
      getReservationInvoiceBuyer({
        billing,
        customerName: "Synthetic Customer",
      })
    ).toEqual({
      kind: "person",
      legalName: "Synthetic Customer",
      address: { ...address, line2: "Unit 2" },
    });
    expect(getDotyposCustomerBillingDetails(billing)).toEqual({
      addressLine1: "Synthetic street 1",
      addressLine2: "Unit 2",
      city: "Prague",
      zip: "100 00",
      country: "CZ",
      companyName: "",
      companyId: "",
      vatId: "",
    });
    expect(
      getDotyposCustomerBillingDetails({
        purpose: "personal",
        invoice: "none",
      })
    ).toBeUndefined();
  });
});
