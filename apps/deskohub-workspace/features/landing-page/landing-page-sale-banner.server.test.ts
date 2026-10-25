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
import {
  type WorkspaceProductFamily,
  type WorkspaceProductTarget,
  workspaceProductFamilies,
} from "@/features/discounts/product-target";
import { m } from "@/features/i18n";
import { getLandingPageSaleBannerLabel } from "./landing-page-sale-banner-content";

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

const bookableWithoutOffice = workspaceProductFamilies.filter(
  (family) => family !== "office"
);

const advertisedLabel = (
  products: readonly WorkspaceProductTarget[],
  bookableProducts: readonly WorkspaceProductFamily[] = workspaceProductFamilies
) =>
  getLandingPageSaleBannerLabel(
    {
      title: "Summer focus",
      adjustment: { kind: "percentage", basisPoints: 2000 },
      products,
    },
    "en-US",
    bookableProducts
  );

const allProductsTemplate = m.landingSaleBannerAllProducts(
  { title: "{title}", adjustment: "{adjustment}" },
  { locale: "en-US" }
);
const selectedProductsTemplate = m.landingSaleBannerSelectedProducts(
  { title: "{title}", adjustment: "{adjustment}" },
  { locale: "en-US" }
);

let officePageEnabled = true;
const isOfficePageEnabled = mock(() => officePageEnabled);

const getBannerEffect = (
  activeSales: readonly ActiveSale[],
  locale: "en-US" | "cs-CZ" = "en-US",
  officePageEnabledValue = true,
  failure?: Error
) => {
  activePublicSales = activeSales;
  activePublicSalesFailure = failure;
  officePageEnabled = officePageEnabledValue;
  getActivePublicSales.mockClear();
  isOfficePageEnabled.mockClear();

  return Effect.gen(function* () {
    const banner = yield* getActiveLandingPageSaleBanner({ locale });
    return { banner };
  }).pipe(
    Effect.provide(
      Layer.succeed(OfficeReservationFeatureFlagService, {
        isEnabled: Effect.sync(isOfficePageEnabled),
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
    ["mixed", [coworkProduct, meetingRoomProduct], "/en-US/reservation/cowork"],
    [
      "mixed without cowork",
      [officeProduct, meetingRoomProduct],
      "/en-US/reservation/meeting-room",
    ],
    ["office-only", [officeProduct], "/en-US/reservation/office"],
  ] as const)("builds the %s sale CTA", async (_label, products, href) => {
    const { banner } = await getBanner([sale(products)]);

    expect(banner).toMatchObject({
      adjustmentKind: "percentage",
      href,
      label: expect.objectContaining({ title: "Summer focus" }),
    });
  });

  test("renders no office-only banner while office reservations are disabled", async () => {
    const { banner } = await getBanner([sale([officeProduct])], "en-US", false);

    expect(banner).toBeUndefined();
  });

  test("advertises only bookable products while office reservations are disabled", async () => {
    const { banner } = await getBanner(
      [sale([coworkProduct, meetingRoomProduct, officeProduct])],
      "en-US",
      false
    );

    expect(banner).toMatchObject({
      href: "/en-US/reservation/cowork",
      label: advertisedLabel(
        [coworkProduct, meetingRoomProduct],
        bookableWithoutOffice
      ),
    });
    expect(banner?.label.template).toBe(allProductsTemplate);
  });

  test("advertises a sale on every bookable product as all products while office reservations are disabled", async () => {
    const { banner } = await getBanner(
      [sale([coworkProduct, meetingRoomProduct])],
      "en-US",
      false
    );

    expect(banner?.label.template).toBe(allProductsTemplate);
  });

  test("advertises a sale without the bookable office as selected products", async () => {
    const { banner } = await getBanner(
      [sale([coworkProduct, meetingRoomProduct])],
      "en-US",
      true
    );

    expect(banner?.label.template).toBe(selectedProductsTemplate);
  });

  test("links a mixed office sale to its bookable family while office reservations are disabled", async () => {
    const { banner } = await getBanner(
      [sale([meetingRoomProduct, officeProduct])],
      "en-US",
      false
    );

    expect(banner).toMatchObject({
      href: "/en-US/reservation/meeting-room",
      label: advertisedLabel([meetingRoomProduct], bookableWithoutOffice),
    });
  });

  test("advertises every product while office reservations are enabled", async () => {
    const { banner } = await getBanner(
      [sale([coworkProduct, meetingRoomProduct, officeProduct])],
      "en-US",
      true
    );

    expect(banner).toMatchObject({
      href: "/en-US/reservation/cowork",
      label: advertisedLabel([
        coworkProduct,
        meetingRoomProduct,
        officeProduct,
      ]),
    });
    expect(banner?.label.template).toBe(allProductsTemplate);
    expect(isOfficePageEnabled).toHaveBeenCalledTimes(1);
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
