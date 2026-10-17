import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Schema } from "effect";
import { normalizedCoworkReservationOrderSchema } from "./cowork-reservation";
import {
  getCoworkReservationSearchParams,
  getReservationDefaultValuesFromPayState,
  getReservationDefaultValuesFromSearchParams,
} from "./cowork-reservation-checkout-query";

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

describe("getCoworkReservationSearchParams", () => {
  test("restores the selected reserved-desk options", () => {
    const searchParams = getCoworkReservationSearchParams({
      entryTier: "reserved-desk",
      date: "2099-06-10",
      coffee: true,
      monitorOption: "2x27-qhd",
    });

    expect(
      getReservationDefaultValuesFromSearchParams(searchParams)
    ).toMatchObject({
      entryTier: "reserved-desk",
      date: "2099-06-10",
      coffee: true,
      monitorOption: "2x27-qhd",
    });
  });

  test("forces reserved-desk coffee and drops the open-space monitor", () => {
    const reservedDeskValues = getReservationDefaultValuesFromSearchParams(
      getCoworkReservationSearchParams({
        entryTier: "reserved-desk",
        coffee: false,
        monitorOption: "2x27-qhd",
      })
    );

    expect(reservedDeskValues.coffee).toBe(true);
    expect(reservedDeskValues.monitorOption).toBe("2x27-qhd");

    const openSpaceValues = getReservationDefaultValuesFromSearchParams(
      getCoworkReservationSearchParams({
        entryTier: "open-space",
        date: "2099-06-10",
        coffee: false,
        monitorOption: "2x27-qhd",
      })
    );

    expect(openSpaceValues).toMatchObject({
      entryTier: "open-space",
      date: "2099-06-10",
      coffee: false,
    });
    expect(openSpaceValues.monitorOption).toBeUndefined();
  });

  test("omits options that were not selected", () => {
    const searchParams = getCoworkReservationSearchParams({
      entryTier: "open-space",
    });

    expect(searchParams.toString()).toBe("entryTier=open-space");
    expect(searchParams.has("date")).toBe(false);
    expect(searchParams.has("coffee")).toBe(false);
    expect(searchParams.has("monitorOption")).toBe(false);
  });
});
