import { describe, expect, test } from "bun:test";
import type { WorkspaceProductTarget } from "@/features/discounts/product-target";
import {
  formatLandingPageSaleBannerLabel,
  getLandingPageSaleBannerContent,
} from "./landing-page-sale-banner-content";

const coworkProduct = {
  kind: "cowork",
} as const satisfies WorkspaceProductTarget;
const meetingRoomProduct = {
  kind: "meeting-room",
} as const satisfies WorkspaceProductTarget;
const officeProduct = {
  kind: "office",
} as const satisfies WorkspaceProductTarget;
const goodsProduct = {
  kind: "goods",
} as const satisfies WorkspaceProductTarget;

const formatLabel = (
  products: readonly WorkspaceProductTarget[],
  adjustment:
    | { readonly kind: "percentage"; readonly basisPoints: number }
    | {
        readonly kind: "fixed";
        readonly amount: {
          readonly value: number;
          readonly exponent: number;
          readonly currency: string;
        };
      } = { kind: "percentage", basisPoints: 2000 }
) =>
  formatLandingPageSaleBannerLabel(
    {
      title: "Summer focus",
      adjustment,
      products,
    },
    "en-US"
  );

describe("formatLandingPageSaleBannerLabel", () => {
  test("describes a sale on every reservation product without clarification", () => {
    expect(
      formatLabel([coworkProduct, meetingRoomProduct, officeProduct])
    ).toBe("Summer focus: 20% off!");
  });

  test("describes a sale on every cowork product", () => {
    expect(formatLabel([coworkProduct])).toBe(
      "Summer focus: 20% off cowork access!"
    );
  });

  test("describes a sale on every meeting-room product", () => {
    expect(formatLabel([meetingRoomProduct])).toBe(
      "Summer focus: 20% off meeting room reservations!"
    );
  });

  test("uses the selected-products fallback for a family mix", () => {
    expect(formatLabel([coworkProduct, meetingRoomProduct])).toBe(
      "Summer focus: 20% off chosen products!"
    );
  });

  test("does not omit office from a mixed sale label", () => {
    expect(formatLabel([coworkProduct, officeProduct])).toBe(
      "Summer focus: 20% off chosen products!"
    );
  });

  test("does not count goods as a missing reservation product family", () => {
    expect(formatLabel([coworkProduct, meetingRoomProduct, goodsProduct])).toBe(
      "Summer focus: 20% off chosen products!"
    );
  });

  test("formats fixed adjustments with their currency", () => {
    expect(
      formatLabel([coworkProduct], {
        kind: "fixed",
        amount: { value: 20_000, exponent: 2, currency: "CZK" },
      })
    ).toBe("Summer focus: CZK 200 off cowork access!");
  });

  test("omits the redundant Czech quantifier", () => {
    expect(
      formatLandingPageSaleBannerLabel(
        {
          title: "Letní soustředění",
          adjustment: { kind: "percentage", basisPoints: 2000 },
          products: [coworkProduct],
        },
        "cs-CZ"
      )
    ).toBe("Letní soustředění: sleva 20 % na coworkingové vstupy!");
  });
});

describe("getLandingPageSaleBannerContent", () => {
  test.each([
    ["percentage", { kind: "percentage" as const, basisPoints: 2000 }],
    [
      "fixed",
      {
        kind: "fixed" as const,
        amount: { value: 20_000, exponent: 2, currency: "CZK" },
      },
    ],
  ])("exposes the %s adjustment kind to the banner", (kind, adjustment) => {
    expect(
      getLandingPageSaleBannerContent({
        locale: "en-US",
        reservationKind: "cowork",
        sale: {
          title: "Summer focus",
          adjustment,
          products: [coworkProduct],
        },
      }).adjustmentKind
    ).toBe(kind);
  });

  test("attributes reservation visits to the home sale banner", () => {
    expect(
      getLandingPageSaleBannerContent({
        locale: "en-US",
        reservationKind: "meeting-room",
        sale: {
          title: "Summer focus",
          adjustment: { kind: "percentage", basisPoints: 2000 },
          products: [meetingRoomProduct],
        },
      }).href
    ).toBe(
      "/en-US/reservation/meeting-room?utm_source=deskohub&utm_medium=sale_banner&utm_content=home_hero"
    );
  });

  test("links an office-only sale to the office reservation page", () => {
    expect(
      getLandingPageSaleBannerContent({
        locale: "en-US",
        reservationKind: "office",
        sale: {
          title: "Office week",
          adjustment: { kind: "percentage", basisPoints: 1000 },
          products: [officeProduct],
        },
      }).href
    ).toBe(
      "/en-US/reservation/office?utm_source=deskohub&utm_medium=sale_banner&utm_content=home_hero"
    );
  });
});
