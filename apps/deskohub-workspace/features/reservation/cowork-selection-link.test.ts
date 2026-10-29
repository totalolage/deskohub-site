import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Schema } from "effect";
import {
  getCoworkReservationDefaultValues,
  normalizedCoworkReservationOrderSchema,
} from "./cowork-reservation";
import { coworkSelectionLink } from "./cowork-selection-link";
import { setReservationSelectionSearchParams } from "./reservation-checkout-query";

const adaEmail = testEmailAddress("ada");

describe("coworkSelectionLink.read", () => {
  test("decodes customer fields independently as URLSearchParams", () => {
    const values = coworkSelectionLink.read(
      new URLSearchParams("name=Ada%20Lovelace&email=invalid@")
    );

    expect(values.name).toBe("Ada Lovelace");
    expect(values.email).toBe("");
    expect(values.phone).toBe("");
  });
});

describe("customer last reservation defaults", () => {
  test("fills an open cowork offer from the last reservation", () => {
    expect(
      coworkSelectionLink.read(
        { date: "2099-06-10" },
        {
          lastReservation: {
            kind: "cowork",
            entryTier: "reserved-desk",
            coffee: true,
            monitorOption: "2x27-qhd",
          },
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
      coworkSelectionLink.read(
        { tier: "reserved-desk", monitorOption: "2x32-4k" },
        { lastReservation }
      )
    ).toMatchObject({
      entryTier: "reserved-desk",
      coffee: true,
      monitorOption: "2x32-4k",
    });
    // Another tier replaces the whole remembered offer.
    expect(
      coworkSelectionLink.read({ tier: "open-space" }, { lastReservation })
    ).toEqual(coworkSelectionLink.read({ tier: "open-space" }));
  });
});

describe("coworkSelectionLink.write", () => {
  test("names the selection in the declared order", () => {
    expect(
      Object.entries(
        coworkSelectionLink.write({
          monitorOption: "2x32-4k",
          coffee: true,
          date: "2099-06-12",
          entryTier: "reserved-desk",
        })
      )
    ).toEqual([
      ["entryTier", "reserved-desk"],
      ["date", "2099-06-12"],
      ["coffee", "true"],
      ["monitorOption", "2x32-4k"],
    ]);
  });

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
      coworkSelectionLink.write(selection)
    );

    expect(coworkSelectionLink.read(searchParams)).toEqual(
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
      coworkSelectionLink.write({
        entryTier: "reserved-desk",
        date: "2099-06-12",
        coffee: true,
        monitorOption: undefined,
      })
    );

    expect(searchParams.get("monitorOption")).toBe("none");
    expect(
      coworkSelectionLink.read(searchParams, { lastReservation })
    ).toMatchObject({ entryTier: "reserved-desk", monitorOption: undefined });
    // A link that leaves the option open still takes the remembered one.
    expect(
      coworkSelectionLink.read(
        { entryTier: "reserved-desk" },
        { lastReservation }
      )
    ).toMatchObject({ monitorOption: "2x27-qhd" });
  });

  test("a tier without an optional workstation writes no monitor option", () => {
    for (const entryTier of ["open-space", "profi"] as const) {
      expect(
        coworkSelectionLink.write({
          entryTier,
          date: "2099-06-12",
          coffee: true,
          monitorOption: undefined,
        }).monitorOption
      ).toBeUndefined();
    }
  });
});

describe("cowork offer links", () => {
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
      coworkSelectionLink.write({
        entryTier: "reserved-desk",
        date: "2099-06-12",
      })
    );

    expect(searchParams.toString()).toBe(
      "entryTier=reserved-desk&date=2099-06-12"
    );
    expect(
      coworkSelectionLink.read(searchParams, { lastReservation })
    ).toMatchObject({
      entryTier: "reserved-desk",
      date: "2099-06-12",
      coffee: true,
      monitorOption: "2x27-qhd",
    });
  });

  test("writes no date when the offer has none", () => {
    expect(coworkSelectionLink.write({ entryTier: "open-space" })).toEqual({
      entryTier: "open-space",
      date: undefined,
      coffee: undefined,
      monitorOption: undefined,
    });
  });
});

describe("coworkSelectionLink.fromStored", () => {
  // Shortly after midnight in Prague, still the previous day in UTC.
  const reservedFrom = Temporal.Instant.from("2099-06-11T22:30:00Z");

  test.each([
    { kind: "cowork", entryTier: "open-space", coffee: false },
    { kind: "cowork", entryTier: "open-space", coffee: true },
    {
      kind: "cowork",
      entryTier: "reserved-desk",
      coffee: true,
      monitorOption: "2x32-4k",
    },
    { kind: "cowork", entryTier: "reserved-desk", coffee: true },
  ] as const)(
    "the parser reads back the stored reservation %o on its workspace date",
    (details) => {
      const selection = coworkSelectionLink.fromStored({
        ...details,
        reservedFrom,
      });
      expect(selection).toMatchObject({
        kind: "cowork",
        entryTier: details.entryTier,
        date: "2099-06-12",
      });
      if (!selection) throw new Error("Expected a cowork selection.");
      const searchParams = new URLSearchParams();
      setReservationSelectionSearchParams(
        searchParams,
        coworkSelectionLink.write(selection)
      );

      expect(coworkSelectionLink.read(searchParams)).toEqual(
        expect.objectContaining({
          entryTier: details.entryTier,
          date: "2099-06-12",
          coffee: details.coffee,
          monitorOption:
            "monitorOption" in details ? details.monitorOption : undefined,
        })
      );
      for (const contactKey of ["name", "email", "phone", "customer"]) {
        expect(searchParams.has(contactKey)).toBe(false);
      }
    }
  );

  test("gives no selection for a historical tier", () => {
    expect(
      coworkSelectionLink.fromStored({
        kind: "cowork",
        entryTier: "basic",
        coffee: false,
        reservedFrom,
      })
    ).toBeUndefined();
  });
});

describe("coworkSelectionLink.restore", () => {
  const restored = getCoworkReservationDefaultValues(
    Schema.decodeUnknownSync(normalizedCoworkReservationOrderSchema)({
      kind: "cowork",
      entryTier: "reserved-desk",
      date: "2099-06-10",
      coffee: true,
      monitorOption: "2x27-qhd",
      name: "Ada Lovelace",
      email: adaEmail,
      phone: "+420 777 000 111",
    })
  );

  test("keeps the restored selection without a selection parameter", () => {
    expect(
      coworkSelectionLink.restore(restored, {
        payState: "signed",
        discountCode: "SPRING",
      })
    ).toEqual(restored);
  });

  test.each([
    ["entryTier", { entryTier: "open-space" }],
    ["legacy tier", { tier: "open-space" }],
  ] as const)(
    "lets the %s parameter replace the whole restored selection",
    (_label, searchParams) => {
      expect(coworkSelectionLink.restore(restored, searchParams)).toEqual({
        ...restored,
        entryTier: "open-space",
        date: "",
        coffee: false,
        monitorOption: undefined,
      });
    }
  );
});
