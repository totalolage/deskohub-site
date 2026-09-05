import { describe, expect, test } from "bun:test";
import { Result, Schema } from "effect";
import { workspaceProductMonitorOptions } from "@/features/checkout/product-catalog";
import {
  coworkReservationProductSchema,
  getStoredCoworkReservationDetails,
  getWorkspaceCoworkProductKey,
  normalizedCoworkReservationProductSchema,
  storedCoworkReservationDetailsSchema,
  withCoworkProductFields,
  workspaceCoworkProductKeySchema,
} from "./cowork-reservation-product";

const parseProduct = Schema.decodeUnknownSync(coworkReservationProductSchema, {
  onExcessProperty: "error",
});
const safeParseProduct = Schema.decodeUnknownResult(
  coworkReservationProductSchema,
  { onExcessProperty: "error" }
);
const safeParseNormalizedProduct = Schema.decodeUnknownResult(
  normalizedCoworkReservationProductSchema,
  { onExcessProperty: "error" }
);
const parseStoredDetails = Schema.decodeUnknownSync(
  storedCoworkReservationDetailsSchema,
  { onExcessProperty: "error" }
);
const safeParseStoredDetails = Schema.decodeUnknownResult(
  storedCoworkReservationDetailsSchema,
  { onExcessProperty: "error" }
);

describe("cowork reservation product", () => {
  test("owns canonical cowork product keys", () => {
    expect(
      getWorkspaceCoworkProductKey({ kind: "cowork", tier: "basic" })
    ).toBe("cowork:basic");
    expect(getWorkspaceCoworkProductKey({ kind: "cowork", tier: "plus" })).toBe(
      "cowork:plus"
    );
    expect(
      getWorkspaceCoworkProductKey({ kind: "cowork", tier: "profi" })
    ).toBe("cowork:profi");
    expect(() =>
      Schema.decodeUnknownSync(workspaceCoworkProductKeySchema)(
        "cowork:enterprise"
      )
    ).toThrow();
  });

  test("normalizes courtesy coffee once at the product boundary", () => {
    expect(
      parseProduct({
        entryTier: "plus",
        coffee: false,
      })
    ).toEqual({
      entryTier: "plus",
      coffee: true,
    });
  });

  test("keeps Basic coffee optional and rejects monitor options", () => {
    expect(parseProduct({ entryTier: "basic", coffee: true })).toEqual({
      entryTier: "basic",
      coffee: true,
    });
    expect(
      Result.isFailure(
        safeParseProduct({
          entryTier: "basic",
          coffee: true,
          monitorOption: "2x27-qhd",
        })
      )
    ).toBe(true);
  });

  test("requires a Profi monitor option", () => {
    expect(
      Result.isFailure(safeParseProduct({ entryTier: "profi", coffee: true }))
    ).toBe(true);
    expect(
      parseProduct({
        entryTier: "profi",
        coffee: false,
        monitorOption: "2x27-qhd",
      })
    ).toEqual({
      entryTier: "profi",
      coffee: true,
      monitorOption: "2x27-qhd",
    });
  });

  test("rejects noncanonical normalized product data", () => {
    expect(
      Result.isFailure(
        safeParseNormalizedProduct({
          entryTier: "plus",
          coffee: false,
        })
      )
    ).toBe(true);
    expect(
      Result.isFailure(
        safeParseNormalizedProduct({
          entryTier: "profi",
          coffee: true,
        })
      )
    ).toBe(true);
  });

  test("projects canonical Profi product intent for JSONB persistence", () => {
    expect(
      getStoredCoworkReservationDetails({
        entryTier: "profi",
        coffee: true,
        monitorOption: "2x32-4k",
      })
    ).toEqual({
      kind: "cowork",
      entryTier: "profi",
      coffee: true,
      monitorOption: "2x32-4k",
    });
  });

  test("stores only Basic product intent", () => {
    expect(
      getStoredCoworkReservationDetails({
        entryTier: "basic",
        coffee: false,
      })
    ).toEqual({
      kind: "cowork",
      entryTier: "basic",
      coffee: false,
    });
  });

  test("projects stored cowork details into compatibility product fields", () => {
    expect(
      withCoworkProductFields({
        id: "basic-reservation",
        reservationDetails: {
          kind: "cowork",
          entryTier: "basic",
          coffee: false,
        },
      })
    ).toEqual({
      id: "basic-reservation",
      reservationDetails: {
        kind: "cowork",
        entryTier: "basic",
        coffee: false,
      },
      productTier: "basic",
      productCoffee: false,
      productMonitorOption: null,
    });
    expect(
      withCoworkProductFields({
        id: "plus-reservation",
        reservationDetails: {
          kind: "cowork",
          entryTier: "plus",
          coffee: true,
        },
      })
    ).toEqual({
      id: "plus-reservation",
      reservationDetails: {
        kind: "cowork",
        entryTier: "plus",
        coffee: true,
      },
      productTier: "plus",
      productCoffee: true,
      productMonitorOption: null,
    });
    expect(
      withCoworkProductFields({
        id: "profi-reservation",
        reservationDetails: {
          kind: "cowork",
          entryTier: "profi",
          coffee: true,
          monitorOption: "2x32-4k",
        },
      })
    ).toEqual({
      id: "profi-reservation",
      reservationDetails: {
        kind: "cowork",
        entryTier: "profi",
        coffee: true,
        monitorOption: "2x32-4k",
      },
      productTier: "profi",
      productCoffee: true,
      productMonitorOption: "2x32-4k",
    });
  });

  test("projects empty cowork product fields for another reservation family", () => {
    expect(
      withCoworkProductFields({
        id: "meeting-room-reservation",
        reservationDetails: { kind: "meeting-room" },
      })
    ).toEqual({
      id: "meeting-room-reservation",
      reservationDetails: { kind: "meeting-room" },
      productTier: null,
      productCoffee: false,
      productMonitorOption: null,
    });
  });

  test("accepts every canonical Profi monitor option in stored details", () => {
    for (const monitorOption of workspaceProductMonitorOptions) {
      expect(
        parseStoredDetails({
          kind: "cowork",
          entryTier: "profi",
          coffee: true,
          monitorOption,
        })
      ).toEqual({
        kind: "cowork",
        entryTier: "profi",
        coffee: true,
        monitorOption,
      });
    }
  });

  test("rejects noncanonical or unrelated stored details", () => {
    expect(
      Result.isFailure(
        safeParseStoredDetails({
          kind: "cowork",
          entryTier: "plus",
          coffee: false,
        })
      )
    ).toBe(true);
    expect(
      Result.isFailure(
        safeParseStoredDetails({
          kind: "cowork",
          entryTier: "profi",
          coffee: true,
        })
      )
    ).toBe(true);
    expect(
      Result.isFailure(
        safeParseStoredDetails({
          kind: "cowork",
          entryTier: "basic",
          coffee: true,
          startsAt: "2099-01-01T10:00:00Z",
        })
      )
    ).toBe(true);
  });
});
