import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Schema } from "effect";
import { normalizedCoworkReservationOrderSchema } from "./cowork-reservation";
import {
  getCoworkOfferSearchParams,
  getCoworkReservationSelectionSearchParams,
  getReservationDefaultValuesFromPayState,
  getReservationDefaultValuesFromSearchParams,
} from "./cowork-reservation-checkout-query";
import { setReservationSelectionSearchParams } from "./reservation-checkout-query";

const adaEmail = testEmailAddress("ada");

describe("getReservationDefaultValuesFromSearchParams", () => {
  test("decodes customer fields independently as URLSearchParams", () => {
    const values = getReservationDefaultValuesFromSearchParams(
      new URLSearchParams("name=Ada%20Lovelace&email=invalid@")
    );

    expect(values.name).toBe("Ada Lovelace");
    expect(values.email).toBe("");
    expect(values.phone).toBe("");
  });
});

describe("getReservationDefaultValuesFromPayState", () => {
  test("restores all reservation details while resetting marketing consent", () => {
    const reservation = Schema.decodeUnknownSync(
      normalizedCoworkReservationOrderSchema
    )({
      kind: "cowork",
      entryTier: "reserved-desk",
      date: "2099-06-10",
      coffee: true,
      monitorOption: "2x27-qhd",
      name: "Ada Lovelace",
      email: adaEmail,
      phone: "+420 777 000 111",
    });

    expect(getReservationDefaultValuesFromPayState(reservation)).toEqual({
      entryTier: "reserved-desk",
      date: "2099-06-10",
      coffee: true,
      monitorOption: "2x27-qhd",
      name: "Ada Lovelace",
      email: adaEmail,
      phone: "+420 777 000 111",
      billing: { purpose: "personal", invoice: "none" },
      marketingConsent: false,
    });
  });
});

describe("customer last reservation defaults", () => {
  test("fills an open cowork offer from the last reservation", () => {
    expect(
      getReservationDefaultValuesFromSearchParams(
        { date: "2099-06-10" },
        {
          kind: "cowork",
          entryTier: "reserved-desk",
          coffee: true,
          monitorOption: "2x27-qhd",
        }
      )
    ).toMatchObject({
      date: "2099-06-10",
      entryTier: "reserved-desk",
      coffee: true,
      monitorOption: "2x27-qhd",
    });
  });

  test("keeps explicit cowork query options over the last reservation", () => {
    const lastReservation = {
      kind: "cowork",
      entryTier: "reserved-desk",
      coffee: true,
      monitorOption: "2x27-qhd",
    } as const;

    expect(
      getReservationDefaultValuesFromSearchParams(
        { tier: "reserved-desk", monitorOption: "2x32-4k" },
        lastReservation
      )
    ).toMatchObject({
      entryTier: "reserved-desk",
      coffee: true,
      monitorOption: "2x32-4k",
    });
    // Another tier replaces the whole remembered offer.
    expect(
      getReservationDefaultValuesFromSearchParams(
        { tier: "open-space" },
        lastReservation
      )
    ).toEqual(
      getReservationDefaultValuesFromSearchParams({ tier: "open-space" })
    );
  });
});

describe("getCoworkReservationSelectionSearchParams", () => {
  test.each([
    {
      entryTier: "open-space",
      date: "2099-06-10",
      coffee: false,
      monitorOption: undefined,
    },
    {
      entryTier: "open-space",
      date: "2099-06-11",
      coffee: true,
      monitorOption: undefined,
    },
    {
      entryTier: "reserved-desk",
      date: "2099-06-12",
      coffee: true,
      monitorOption: "2x32-4k",
    },
    {
      entryTier: "reserved-desk",
      date: "2099-06-12",
      coffee: true,
      monitorOption: undefined,
    },
  ] as const)("the parser reads back the written selection %o", (selection) => {
    const searchParams = new URLSearchParams(
      "entryTier=reserved-desk&monitorOption=2x27-qhd&discountCode=SPRING"
    );
    setReservationSelectionSearchParams(
      searchParams,
      getCoworkReservationSelectionSearchParams(selection)
    );

    expect(getReservationDefaultValuesFromSearchParams(searchParams)).toEqual(
      expect.objectContaining({ ...selection })
    );
    expect(searchParams.get("discountCode")).toBe("SPRING");
  });

  test("an optional workstation turned off stays off over the last reservation", () => {
    const lastReservation = {
      kind: "cowork",
      entryTier: "reserved-desk",
      coffee: true,
      monitorOption: "2x27-qhd",
    } as const;
    const searchParams = new URLSearchParams();
    setReservationSelectionSearchParams(
      searchParams,
      getCoworkReservationSelectionSearchParams({
        entryTier: "reserved-desk",
        date: "2099-06-12",
        coffee: true,
        monitorOption: undefined,
      })
    );

    expect(searchParams.get("monitorOption")).toBe("none");
    expect(
      getReservationDefaultValuesFromSearchParams(searchParams, lastReservation)
    ).toMatchObject({ entryTier: "reserved-desk", monitorOption: undefined });
    // A link that leaves the option open still takes the remembered one.
    expect(
      getReservationDefaultValuesFromSearchParams(
        { entryTier: "reserved-desk" },
        lastReservation
      )
    ).toMatchObject({ monitorOption: "2x27-qhd" });
  });

  test("a tier without an optional workstation writes no monitor option", () => {
    for (const entryTier of ["open-space", "profi"] as const) {
      expect(
        getCoworkReservationSelectionSearchParams({
          entryTier,
          date: "2099-06-12",
          coffee: true,
          monitorOption: undefined,
        }).monitorOption
      ).toBeUndefined();
    }
  });
});

describe("getCoworkOfferSearchParams", () => {
  test("names the tier and date and leaves the add-ons to the last reservation", () => {
    const lastReservation = {
      kind: "cowork",
      entryTier: "reserved-desk",
      coffee: true,
      monitorOption: "2x27-qhd",
    } as const;
    const searchParams = new URLSearchParams();
    setReservationSelectionSearchParams(
      searchParams,
      getCoworkOfferSearchParams({
        entryTier: "reserved-desk",
        date: "2099-06-12",
      })
    );

    expect(searchParams.toString()).toBe(
      "entryTier=reserved-desk&date=2099-06-12"
    );
    expect(
      getReservationDefaultValuesFromSearchParams(searchParams, lastReservation)
    ).toMatchObject({
      entryTier: "reserved-desk",
      date: "2099-06-12",
      coffee: true,
      monitorOption: "2x27-qhd",
    });
  });

  test("writes no date when the offer has none", () => {
    expect(getCoworkOfferSearchParams({ entryTier: "open-space" })).toEqual({
      entryTier: "open-space",
      date: undefined,
    });
  });
});
