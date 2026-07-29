import { describe, expect, test } from "bun:test";
import {
  workspaceCoworkProductTiers,
  workspaceMeetingRoomDurationOptions,
} from "@/features/checkout/product-catalog";
import type { WorkspaceProductIdentity } from "@/features/checkout/product-identity";
import {
  formatLandingPageSaleBannerLabel,
  getLandingPageSaleBannerContent,
} from "./landing-page-sale-banner-content";

const coworkProducts = workspaceCoworkProductTiers.map(
  (tier): WorkspaceProductIdentity => ({ kind: "cowork", tier })
);
const meetingRoomProducts = workspaceMeetingRoomDurationOptions.map(
  (durationMinutes): WorkspaceProductIdentity => ({
    kind: "meeting-room",
    durationMinutes,
  })
);

const formatLabel = (
  products: readonly WorkspaceProductIdentity[],
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
  test("describes a sale on every product without clarification", () => {
    expect(formatLabel([...coworkProducts, ...meetingRoomProducts])).toBe(
      "Summer focus: 20% off!"
    );
  });

  test("describes a sale on every cowork product", () => {
    expect(formatLabel(coworkProducts)).toBe(
      "Summer focus: 20% off cowork access!"
    );
  });

  test("describes a sale on every meeting-room product", () => {
    expect(formatLabel(meetingRoomProducts)).toBe(
      "Summer focus: 20% off meeting room reservations!"
    );
  });

  test("describes all cowork and selected meeting-room products", () => {
    expect(formatLabel([...coworkProducts, meetingRoomProducts[0]!])).toBe(
      "Summer focus: 20% off cowork access and chosen meeting room reservations!"
    );
  });

  test("describes selected cowork and all meeting-room products", () => {
    expect(formatLabel([coworkProducts[0]!, ...meetingRoomProducts])).toBe(
      "Summer focus: 20% off chosen cowork access and meeting room reservations!"
    );
  });

  test("uses the selected-products fallback for a partial mix", () => {
    expect(formatLabel([coworkProducts[0]!, meetingRoomProducts[0]!])).toBe(
      "Summer focus: 20% off chosen products!"
    );
  });

  test("formats fixed adjustments with their currency", () => {
    expect(
      formatLabel(coworkProducts, {
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
          products: coworkProducts,
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
        href: "/en-US/reserve/cowork",
        locale: "en-US",
        sale: {
          title: "Summer focus",
          adjustment,
          products: coworkProducts,
        },
      }).adjustmentKind
    ).toBe(kind);
  });
});
