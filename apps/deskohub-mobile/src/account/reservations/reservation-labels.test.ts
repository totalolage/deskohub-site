import { describe, expect, test } from "bun:test";
import type { CustomerReservationProduct } from "@deskohub/workspace-customer-api";
import {
  reservationKindTitle,
  reservationProductTitle,
  reservationStatusLabel,
} from "./reservation-labels";

const locales = ["en-US", "cs-CZ"] as const;
const products: ReadonlyArray<CustomerReservationProduct> = [
  { kind: "cowork", tier: "basic" },
  { kind: "cowork", tier: "plus" },
  { kind: "cowork", tier: "profi" },
  { kind: "cowork", tier: "open-space" },
  { kind: "cowork", tier: "reserved-desk" },
  { kind: "meeting-room" },
  { kind: "office" },
  { kind: "other" },
];
const statuses = [
  "confirmed",
  "pending",
  "cancelled",
  "requires-attention",
] as const;

const allDistinctAndPresent = (labels: ReadonlyArray<string>) => {
  expect(labels.every((label) => label.trim().length > 0)).toBe(true);
  expect(new Set(labels).size).toBe(labels.length);
};

describe("reservation labels", () => {
  test("names every product and tier apart, in both locales", () => {
    for (const locale of locales) {
      allDistinctAndPresent(
        products.map((product) => reservationProductTitle(product, locale))
      );
    }
  });

  test("names every kind of space apart, in both locales", () => {
    for (const locale of locales) {
      allDistinctAndPresent(
        (["cowork", "meeting-room", "office"] as const).map((kind) =>
          reservationKindTitle(kind, locale)
        )
      );
    }
  });

  test("words every history status apart, in both locales", () => {
    for (const locale of locales) {
      allDistinctAndPresent(
        statuses.map((status) => reservationStatusLabel(status, locale))
      );
    }
  });
});
