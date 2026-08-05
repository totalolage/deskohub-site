import "@/shared/testing/workspace-test-env";
import "@/shared/polyfills/temporal";
import { describe, expect, mock, test } from "bun:test";
import { Effect, Logger, References, Schema } from "effect";
import { TestClock } from "effect/testing";
import { workspaceMeetingRoomCatalog } from "@/features/checkout/product-catalog";
import type { WorkspaceProductIdentity } from "@/features/checkout/product-identity";
import { type ActiveSale, discountIdSchema } from "@/features/discounts";
import { DiscountServiceMock } from "@/features/discounts/discount.service.mock";

mock.module("server-only", () => ({}));

const { getActiveLandingPageSaleBanner } = await import(
  "./landing-page-sale-banner.server"
);

const discountId = Schema.decodeUnknownSync(discountIdSchema);
const coworkProduct = {
  kind: "cowork",
  tier: "basic",
} satisfies WorkspaceProductIdentity;
const meetingRoomProduct = {
  kind: "meeting-room",
  duration: workspaceMeetingRoomCatalog[0]!.duration,
} satisfies WorkspaceProductIdentity;

const sale = (
  products: readonly WorkspaceProductIdentity[],
  id = "summer-focus"
): ActiveSale => ({
  discount: {
    id: discountId(id),
    label: "Summer focus",
    adjustment: { kind: "percentage", basisPoints: 2000 },
  },
  products,
});

const getBannerEffect = (
  activeSales: readonly ActiveSale[],
  locale: "en-US" | "cs-CZ" = "en-US"
) => {
  const discoverActiveSales = mock(() => Effect.succeed(activeSales));

  return Effect.gen(function* () {
    yield* TestClock.setTime(
      Temporal.Instant.from("2026-07-19T22:30:00Z").epochMilliseconds
    );
    const banner = yield* getActiveLandingPageSaleBanner({ locale });
    return { banner, discoverActiveSales };
  }).pipe(
    Effect.provide(DiscountServiceMock({ discoverActiveSales })),
    Effect.provide(TestClock.layer())
  );
};

const getBanner = (
  activeSales: readonly ActiveSale[],
  locale: "en-US" | "cs-CZ" = "en-US"
) => getBannerEffect(activeSales, locale).pipe(Effect.runPromise);

describe("getActiveLandingPageSaleBanner", () => {
  test.each([
    [
      "cowork-only",
      [coworkProduct],
      "/en-US/reservation/cowork?utm_source=deskohub&utm_medium=sale_banner&utm_content=home_hero",
    ],
    [
      "meeting-room-only",
      [meetingRoomProduct],
      "/en-US/reservation/meeting-room?utm_source=deskohub&utm_medium=sale_banner&utm_content=home_hero",
    ],
    [
      "mixed",
      [coworkProduct, meetingRoomProduct],
      "/en-US/reservation/cowork?utm_source=deskohub&utm_medium=sale_banner&utm_content=home_hero",
    ],
  ] as const)("builds the %s sale CTA", async (_label, products, href) => {
    const { banner, discoverActiveSales } = await getBanner([sale(products)]);

    expect(banner).toMatchObject({
      adjustmentKind: "percentage",
      href,
      label: expect.stringContaining("Summer focus"),
    });
    expect(discoverActiveSales).toHaveBeenCalledWith({
      currentDate: Temporal.PlainDate.from("2026-07-20"),
      locale: "en-US",
    });
  });

  test("renders no banner when there is no active sale", async () => {
    const { banner } = await getBanner([]);

    expect(banner).toBeUndefined();
  });

  test("fails closed and logs when overlapping sales are ambiguous", async () => {
    const logRecords: {
      readonly annotations: Record<string, unknown>;
      readonly level: string;
    }[] = [];
    const logger = Logger.make((options) => {
      logRecords.push({
        annotations: options.fiber.getRef(References.CurrentLogAnnotations),
        level: options.logLevel,
      });
    });

    const { banner } = await getBannerEffect([
      sale([coworkProduct]),
      sale([meetingRoomProduct], "autumn"),
    ]).pipe(Effect.provide(Logger.layer([logger])), Effect.runPromise);

    expect(banner).toBeUndefined();
    expect(logRecords).toContainEqual({
      level: "Error",
      annotations: expect.objectContaining({
        landingPageBoundary: "sale_banner",
        landingPageErrorReason: "overlapping_active_sales",
        activeSaleCount: 2,
      }),
    });
    expect(JSON.stringify(logRecords)).not.toContain("Summer focus");
  });
});
