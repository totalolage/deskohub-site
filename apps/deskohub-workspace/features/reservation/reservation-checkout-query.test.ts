import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { getCoworkReservationSelectionSearchParams } from "./cowork-reservation-checkout-query";
import { getMeetingRoomReservationSelectionSearchParams } from "./meeting-room-reservation-checkout-query";
import { getOfficeReservationSelectionSearchParams } from "./office-reservation-checkout-query";
import {
  getReservationCustomerQueryMode,
  setReservationSelectionSearchParams,
} from "./reservation-checkout-query";

describe("getReservationCustomerQueryMode", () => {
  test("honours an explicit customer parameter over contact fields", () => {
    expect(
      getReservationCustomerQueryMode({
        customer: "account",
        name: "Ada Lovelace",
      })
    ).toBe("account");
    expect(getReservationCustomerQueryMode({ customer: " contact " })).toBe(
      "contact"
    );
  });

  test("treats any contact field as a request for that exact contact", () => {
    expect(
      getReservationCustomerQueryMode(
        new URLSearchParams("phone=%2B420777777777")
      )
    ).toBe("contact");
    expect(getReservationCustomerQueryMode({ email: "invalid@" })).toBe(
      "contact"
    );
  });

  test("leaves the mode open without a customer or contact parameter", () => {
    expect(getReservationCustomerQueryMode({ tier: "plus" })).toBeUndefined();
    expect(
      getReservationCustomerQueryMode({ customer: "someone", name: "  " })
    ).toBeUndefined();
  });

  test("ignores contact fields on forms whose links never prefill them", () => {
    expect(
      getReservationCustomerQueryMode(
        { name: "Ada Lovelace" },
        { prefillsContact: false }
      )
    ).toBeUndefined();
    expect(
      getReservationCustomerQueryMode(
        { customer: "contact" },
        { prefillsContact: false }
      )
    ).toBe("contact");
  });
});

describe("reservation selection search parameters", () => {
  const contactParams = ["name", "email", "phone", "customer"];
  const contact = {
    name: "Ada Lovelace",
    email: testEmailAddress("ada"),
    phone: "+420777777777",
    customer: "contact",
  };

  test("never carry contact details or the customer mode", () => {
    // Writers take the whole form values, contact included, in real use.
    const selections = [
      getCoworkReservationSelectionSearchParams({
        entryTier: "reserved-desk",
        date: "2099-06-10",
        coffee: true,
        monitorOption: "2x27-qhd",
        ...contact,
      }),
      getMeetingRoomReservationSelectionSearchParams({
        startDateTime: "2099-08-12T09:00",
        duration: "hour:1",
        ...contact,
      }),
      getOfficeReservationSelectionSearchParams({
        startsOn: "2099-06-12",
        dayCount: 2,
        seats: 3,
        ...contact,
      }),
    ];

    for (const selection of selections) {
      for (const param of contactParams) {
        expect(Object.keys(selection)).not.toContain(param);
      }
    }
  });

  test("leave the parameters outside the selection as they arrived", () => {
    const searchParams = new URLSearchParams({
      ...contact,
      discountCode: "SPRING",
      utm_source: "newsletter",
      date: "2099-06-09",
      monitorOption: "2x27-qhd",
    });
    setReservationSelectionSearchParams(searchParams, {
      date: "2099-06-10",
      monitorOption: undefined,
    });

    expect(Object.fromEntries(searchParams)).toEqual({
      ...contact,
      discountCode: "SPRING",
      utm_source: "newsletter",
      date: "2099-06-10",
    });
  });
});
