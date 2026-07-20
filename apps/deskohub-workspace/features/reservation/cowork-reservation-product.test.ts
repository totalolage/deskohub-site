import { describe, expect, test } from "bun:test";
import { Result, Schema } from "effect";
import { makeSchemaParser } from "@/shared/utils/schema-parser";
import {
  coworkReservationProductSchema,
  getWorkspaceCoworkProductKey,
  getWorkspaceReservationProductColumns,
  normalizedCoworkReservationProductSchema,
  workspaceCoworkProductKeySchema,
} from "./cowork-reservation-product";

const productParser = makeSchemaParser(coworkReservationProductSchema, {
  onExcessProperty: "error",
});
const normalizedProductParser = makeSchemaParser(
  normalizedCoworkReservationProductSchema,
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
      productParser.parse({
        entryTier: "plus",
        coffee: false,
      })
    ).toEqual({
      entryTier: "plus",
      coffee: true,
    });
  });

  test("keeps Basic coffee optional and rejects monitor options", () => {
    expect(productParser.parse({ entryTier: "basic", coffee: true })).toEqual({
      entryTier: "basic",
      coffee: true,
    });
    expect(
      Result.isFailure(
        productParser.safeParse({
          entryTier: "basic",
          coffee: true,
          monitorOption: "2x27-qhd",
        })
      )
    ).toBe(true);
  });

  test("requires a Profi monitor option", () => {
    expect(
      Result.isFailure(
        productParser.safeParse({ entryTier: "profi", coffee: true })
      )
    ).toBe(true);
    expect(
      productParser.parse({
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
        normalizedProductParser.safeParse({
          entryTier: "plus",
          coffee: false,
        })
      )
    ).toBe(true);
    expect(
      Result.isFailure(
        normalizedProductParser.safeParse({
          entryTier: "profi",
          coffee: true,
        })
      )
    ).toBe(true);
  });

  test("projects the canonical product into persistence columns", () => {
    expect(
      getWorkspaceReservationProductColumns({
        entryTier: "profi",
        coffee: true,
        monitorOption: "2x32-4k",
      })
    ).toEqual({
      productTier: "profi",
      productCoffee: true,
      productMonitorOption: "2x32-4k",
    });
  });

  test("clears unsupported persistence columns inside the product projection", () => {
    expect(
      getWorkspaceReservationProductColumns({
        entryTier: "basic",
        coffee: false,
      })
    ).toEqual({
      productTier: "basic",
      productCoffee: false,
      productMonitorOption: null,
    });
  });
});
