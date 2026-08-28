import "@/shared/testing/workspace-test-env";
import "@/shared/polyfills/temporal";
import { describe, expect, mock, test } from "bun:test";
import {
  type Context,
  Effect,
  Layer,
  Logger,
  References,
  Schema,
} from "effect";
import { type ActiveSale, discountIdSchema } from "@/features/discounts";
import type { WorkspaceProductTarget } from "@/features/discounts/product-target";

type LogAnnotations = Context.Service.Shape<
  typeof References.CurrentLogAnnotations
>;

mock.module("server-only", () => ({}));

let activePublicSales: readonly ActiveSale[] = [];
let activePublicSalesFailure: Error | undefined;
const getActivePublicSales = mock(() =>
  activePublicSalesFailure
    ? Effect.fail(activePublicSalesFailure)
    : Effect.succeed(activePublicSales)
);
mock.module("@/features/discounts/active-public-sales.server", () => ({
  getActivePublicSales,
}));

const { OfficeReservationFeatureFlagService } = await import(
  "@/features/office/backend/office-reservation-feature-flag.service"
);
const { getActiveLandingPageSaleBanner } = await import(
  "./landing-page-sale-banner.server"
);

const discountId = Schema.decodeUnknownSync(discountIdSchema);
const coworkProduct = {
  kind: "cowork",
} satisfies WorkspaceProductTarget;
const meetingRoomProduct = {
  kind: "meeting-room",
} satisfies WorkspaceProductTarget;
const officeProduct = {
  kind: "office",
} satisfies WorkspaceProductTarget;

const sale = (
  products: readonly WorkspaceProductTarget[],
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
  locale: "en-US" | "cs-CZ" = "en-US",
  officePageEnabled = true,
  failure?: Error
) => {
  activePublicSales = activeSales;
  activePublicSalesFailure = failure;
  getActivePublicSales.mockClear();

  return Effect.gen(function* () {
    const banner = yield* getActiveLandingPageSaleBanner({ locale });
    return { banner };
  }).pipe(
    Effect.provide(
      Layer.succeed(OfficeReservationFeatureFlagService, {
        isEnabled: Effect.succeed(officePageEnabled),
      })
    )
  );
};

const getBanner = (
  activeSales: readonly ActiveSale[],
  locale: "en-US" | "cs-CZ" = "en-US",
  officePageEnabled = true
) =>
  getBannerEffect(activeSales, locale, officePageEnabled).pipe(
    Effect.runPromise
  );

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
    [
      "mixed without cowork",
      [officeProduct, meetingRoomProduct],
      "/en-US/reservation/meeting-room?utm_source=deskohub&utm_medium=sale_banner&utm_content=home_hero",
    ],
    [
      "office-only",
      [officeProduct],
      "/en-US/reservation/office?utm_source=deskohub&utm_medium=sale_banner&utm_content=home_hero",
    ],
  ] as const)("builds the %s sale CTA", async (_label, products, href) => {
    const { banner } = await getBanner([sale(products)]);

    expect(banner).toMatchObject({
      adjustmentKind: "percentage",
      href,
      label: expect.stringContaining("Summer focus"),
    });
    expect(getActivePublicSales).toHaveBeenCalledWith({ locale: "en-US" });
  });

  test("renders no banner when there is no active sale", async () => {
    const { banner } = await getBanner([]);

    expect(banner).toBeUndefined();
  });

  test("renders no office-only banner while office reservations are disabled", async () => {
    const { banner } = await getBanner([sale([officeProduct])], "en-US", false);

    expect(banner).toBeUndefined();
  });

  test("renders no mixed office banner while office reservations are disabled", async () => {
    const { banner } = await getBanner(
      [sale([meetingRoomProduct, officeProduct])],
      "en-US",
      false
    );

    expect(banner).toBeUndefined();
  });

  test("fails closed and logs when overlapping sales are ambiguous", async () => {
    const logRecords: {
      readonly annotations: LogAnnotations;
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

  test("fails closed and logs when active sale lookup fails", async () => {
    const logRecords: {
      readonly annotations: LogAnnotations;
      readonly level: string;
      readonly message: string;
    }[] = [];
    const logger = Logger.make((options) => {
      logRecords.push({
        annotations: options.fiber.getRef(References.CurrentLogAnnotations),
        level: options.logLevel,
        message: options.message.join(""),
      });
    });

    const { banner } = await getBannerEffect(
      [],
      "en-US",
      true,
      new Error("calendar offline")
    ).pipe(Effect.provide(Logger.layer([logger])), Effect.runPromise);

    expect(banner).toBeUndefined();
    expect(logRecords).toContainEqual({
      level: "Warn",
      message: "Landing sale banner lookup failed",
      annotations: expect.objectContaining({
        landingPageBoundary: "sale_banner",
        landingPageErrorReason: "sale_lookup_failed",
      }),
    });
  });
});
