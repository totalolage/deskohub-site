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
      getWorkspaceCoworkProductKey({ kind: "cowork", tier: "open-space" })
    ).toBe("cowork:open-space");
    expect(
      getWorkspaceCoworkProductKey({ kind: "cowork", tier: "reserved-desk" })
    ).toBe("cowork:reserved-desk");
    expect(
      getWorkspaceCoworkProductKey({ kind: "cowork", tier: "basic" })
    ).toBe("cowork:basic");
    expect(() =>
      Schema.decodeUnknownSync(workspaceCoworkProductKeySchema)(
        "cowork:enterprise"
      )
    ).toThrow();
  });

  test("normalizes reserved-desk coffee once at the product boundary", () => {
    expect(
      parseProduct({
        entryTier: "reserved-desk",
        coffee: false,
      })
    ).toEqual({
      entryTier: "reserved-desk",
      coffee: true,
    });
  });

  test("keeps Open Space coffee optional and rejects monitor options", () => {
    expect(parseProduct({ entryTier: "open-space", coffee: true })).toEqual({
      entryTier: "open-space",
      coffee: true,
    });
    expect(parseProduct({ entryTier: "open-space", coffee: false })).toEqual({
      entryTier: "open-space",
      coffee: false,
    });
    expect(
      Result.isFailure(
        safeParseProduct({
          entryTier: "open-space",
          coffee: true,
          monitorOption: "2x27-qhd",
        })
      )
    ).toBe(true);
  });

  test("keeps the reserved-desk workstation addon optional", () => {
    expect(
      parseProduct({
        entryTier: "reserved-desk",
        coffee: false,
        monitorOption: "2x27-qhd",
      })
    ).toEqual({
      entryTier: "reserved-desk",
      coffee: true,
      monitorOption: "2x27-qhd",
    });
    expect(parseProduct({ entryTier: "reserved-desk", coffee: false })).toEqual(
      {
        entryTier: "reserved-desk",
        coffee: true,
      }
    );
  });

  test("rejects noncanonical normalized product data", () => {
    expect(
      Result.isFailure(
        safeParseNormalizedProduct({
          entryTier: "reserved-desk",
          coffee: false,
        })
      )
    ).toBe(true);
    expect(
      Result.isFailure(
        safeParseNormalizedProduct({
          entryTier: "reserved-desk",
          coffee: true,
          monitorOption: "2x27-qhd",
          extra: true,
        })
      )
    ).toBe(true);
  });

  test("projects canonical Reserved Desk product intent for JSONB persistence", () => {
    expect(
      getStoredCoworkReservationDetails({
        entryTier: "reserved-desk",
        coffee: true,
        monitorOption: "2x32-4k",
      })
    ).toEqual({
      kind: "cowork",
      entryTier: "reserved-desk",
      coffee: true,
      monitorOption: "2x32-4k",
    });
    expect(
      getStoredCoworkReservationDetails({
        entryTier: "open-space",
        coffee: true,
      })
    ).toEqual({
      kind: "cowork",
      entryTier: "open-space",
      coffee: true,
    });
  });

  test("stores historical Basic product intent", () => {
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
        id: "open-space-reservation",
        reservationDetails: {
          kind: "cowork",
          entryTier: "open-space",
          coffee: false,
        },
      })
    ).toEqual({
      id: "open-space-reservation",
      reservationDetails: {
        kind: "cowork",
        entryTier: "open-space",
        coffee: false,
      },
      productTier: "open-space",
      productCoffee: false,
      productMonitorOption: null,
    });
    expect(
      withCoworkProductFields({
        id: "reserved-desk-reservation",
        reservationDetails: {
          kind: "cowork",
          entryTier: "reserved-desk",
          coffee: true,
          monitorOption: "2x32-4k",
        },
      })
    ).toEqual({
      id: "reserved-desk-reservation",
      reservationDetails: {
        kind: "cowork",
        entryTier: "reserved-desk",
        coffee: true,
        monitorOption: "2x32-4k",
      },
      productTier: "reserved-desk",
      productCoffee: true,
      productMonitorOption: "2x32-4k",
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

  test("accepts every canonical Reserved Desk monitor option in stored details", () => {
    for (const monitorOption of workspaceProductMonitorOptions) {
      expect(
        parseStoredDetails({
          kind: "cowork",
          entryTier: "reserved-desk",
          coffee: true,
          monitorOption,
        })
      ).toEqual({
        kind: "cowork",
        entryTier: "reserved-desk",
        coffee: true,
        monitorOption,
      });
    }
  });

  test("keeps historical stored variants decodable", () => {
    for (const details of [
      { kind: "cowork", entryTier: "basic", coffee: false },
      { kind: "cowork", entryTier: "plus", coffee: true },
      {
        kind: "cowork",
        entryTier: "profi",
        coffee: true,
        monitorOption: "2x27-4k",
      },
    ] as const) {
      expect(parseStoredDetails(details)).toEqual(details);
    }
  });

  test("rejects noncanonical or unrelated stored details", () => {
    expect(
      Result.isFailure(
        safeParseStoredDetails({
          kind: "cowork",
          entryTier: "reserved-desk",
          coffee: false,
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
