import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { reservationBillingSelectionSchema } from "./reservation-billing";
import { getReservationCustomerProfile } from "./reservation-customer-profile";

const billing = Schema.decodeUnknownSync(reservationBillingSelectionSchema);

const address = {
  line1: "Main Street 1",
  city: "Prague",
  postalCode: "110 00",
  country: "CZ",
};

const contact = { name: "Ada Lovelace", phone: "+420 777 777 777" };

describe("getReservationCustomerProfile", () => {
  test("splits the contact name and reads the phone number", () => {
    expect(
      getReservationCustomerProfile(
        {
          name: "  Ada   King Lovelace ",
          phone: "+420 777 777 777",
        },
        "CZ"
      )
    ).toEqual({
      firstName: "Ada",
      lastName: "King Lovelace",
      phone: "+420777777777",
    });
  });

  test.each([
    ["DE", "0151 23456789", "+4915123456789"],
    ["UA", "050 123 4567", "+380501234567"],
    ["CZ", "777 123 456", "+420777123456"],
    ["DE", "+420 777 123 456", "+420777123456"],
  ] as const)("reads the phone in region %s: %s", (region, phone, saved) => {
    expect(
      getReservationCustomerProfile({ name: "Ada Lovelace", phone }, region)
        .phone
    ).toBe(saved);
  });

  test("leaves out the last name of a single-word name", () => {
    const profile = getReservationCustomerProfile(
      {
        name: "Ada",
        phone: "+420 777 777 777",
      },
      "CZ"
    );

    expect(profile.firstName).toBe("Ada");
    expect(profile.lastName).toBeUndefined();
  });

  test.each([
    ["absent", undefined],
    [
      "not asked for an invoice",
      billing({ purpose: "personal", invoice: "none" }),
    ],
  ] as const)("saves no billing when it is %s", (_label, selection) => {
    const profile = getReservationCustomerProfile(
      {
        ...contact,
        ...(selection && { billing: selection }),
      },
      "CZ"
    );

    expect(profile).not.toHaveProperty("billing");
  });

  test("saves a requested invoice's address as personal billing", () => {
    const profile = getReservationCustomerProfile(
      {
        ...contact,
        billing: billing({
          purpose: "personal",
          invoice: "requested",
          address: { ...address, line2: "Floor 2" },
        }),
      },
      "CZ"
    );

    expect(profile.billing).toEqual({
      kind: "personal",
      addressLine1: "Main Street 1",
      addressLine2: "Floor 2",
      city: "Prague",
      zip: "110 00",
      country: "CZ",
    });
  });

  test("leaves out a missing second address line", () => {
    const profile = getReservationCustomerProfile(
      {
        ...contact,
        billing: billing({
          purpose: "personal",
          invoice: "requested",
          address,
        }),
      },
      "CZ"
    );

    expect(profile.billing).not.toHaveProperty("addressLine2");
  });

  test("saves a required invoice's buyer as business billing", () => {
    const profile = getReservationCustomerProfile(
      {
        ...contact,
        billing: billing({
          purpose: "business",
          invoice: "required",
          buyer: {
            kind: "business",
            legalName: "Analytical Engines s.r.o.",
            companyId: "27074358",
            vatId: "CZ27074358",
            address,
          },
        }),
      },
      "CZ"
    );

    expect(profile.billing).toEqual({
      kind: "business",
      companyName: "Analytical Engines s.r.o.",
      companyId: "27074358",
      vatId: "CZ27074358",
      addressLine1: "Main Street 1",
      city: "Prague",
      zip: "110 00",
      country: "CZ",
    });
  });

  test("leaves out a business buyer's missing VAT ID", () => {
    const profile = getReservationCustomerProfile(
      {
        ...contact,
        billing: billing({
          purpose: "business",
          invoice: "required",
          buyer: {
            kind: "business",
            legalName: "Analytical Engines s.r.o.",
            companyId: "27074358",
            address,
          },
        }),
      },
      "CZ"
    );

    expect(profile.billing).toMatchObject({
      kind: "business",
      companyId: "27074358",
    });
    expect(profile.billing).not.toHaveProperty("vatId");
  });
});
