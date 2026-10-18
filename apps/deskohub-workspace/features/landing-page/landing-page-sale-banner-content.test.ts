import { describe, expect, test } from "bun:test";
import { formatDiscountAdjustment } from "@/features/checkout/format-discount-adjustment";
import {
  type WorkspaceProductFamily,
  type WorkspaceProductTarget,
  workspaceProductFamilies,
} from "@/features/discounts/product-target";
import { type Locale, m } from "@/features/i18n";
import { getLandingPageSaleBannerLabel } from "./landing-page-sale-banner-content";

const coworkProduct = {
  kind: "cowork",
} as const satisfies WorkspaceProductTarget;
const meetingRoomProduct = {
  kind: "meeting-room",
} as const satisfies WorkspaceProductTarget;
const officeProduct = {
  kind: "office",
} as const satisfies WorkspaceProductTarget;

const bookableWithoutOffice = workspaceProductFamilies.filter(
  (family) => family !== "office"
);

const formatLabel = (
  products: readonly WorkspaceProductTarget[],
  {
    bookableProducts = workspaceProductFamilies,
    locale = "en-US",
  }: {
    readonly bookableProducts?: readonly WorkspaceProductFamily[];
    readonly locale?: Locale;
  } = {},
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
  getLandingPageSaleBannerLabel(
    {
      title: "Summer focus",
      adjustment,
      products,
    },
    locale,
    bookableProducts
  );

const bannerTemplate = (
  message: typeof m.landingSaleBannerAllProducts,
  locale: Locale = "en-US"
) => message({ title: "{title}", adjustment: "{adjustment}" }, { locale });

const summerFocusLabel = (template: string, locale: Locale = "en-US") => ({
  template,
  title: "Summer focus",
  adjustment: formatDiscountAdjustment(
    { kind: "percentage", basisPoints: 2000 },
    locale
  ),
});

const locales = ["en-US", "cs-CZ"] as const satisfies readonly Locale[];

describe("getLandingPageSaleBannerLabel", () => {
  test("describes a sale on every product without clarification", () => {
    expect(
      formatLabel([coworkProduct, meetingRoomProduct, officeProduct])
    ).toEqual(summerFocusLabel(bannerTemplate(m.landingSaleBannerAllProducts)));
  });

  test.each(locales)(
    "describes a sale on every bookable product as all products in %s while offices are switched off",
    (locale) => {
      expect(
        formatLabel([coworkProduct, meetingRoomProduct], {
          bookableProducts: bookableWithoutOffice,
          locale,
        })
      ).toEqual(
        summerFocusLabel(
          bannerTemplate(m.landingSaleBannerAllProducts, locale),
          locale
        )
      );
    }
  );

  test.each(locales)(
    "describes a sale on every product as all products in %s while offices are bookable",
    (locale) => {
      expect(
        formatLabel([coworkProduct, meetingRoomProduct, officeProduct], {
          locale,
        })
      ).toEqual(
        summerFocusLabel(
          bannerTemplate(m.landingSaleBannerAllProducts, locale),
          locale
        )
      );
    }
  );

  test.each(locales)(
    "uses the selected-products wording in %s when a bookable office is left out",
    (locale) => {
      expect(
        formatLabel([coworkProduct, meetingRoomProduct], { locale })
      ).toEqual(
        summerFocusLabel(
          bannerTemplate(m.landingSaleBannerSelectedProducts, locale),
          locale
        )
      );
    }
  );

  test("uses the selected-products wording for one cowork tier while offices are switched off", () => {
    expect(
      formatLabel(
        [{ kind: "cowork", tier: "open-space" }, meetingRoomProduct],
        {
          bookableProducts: bookableWithoutOffice,
        }
      )
    ).toEqual(
      summerFocusLabel(bannerTemplate(m.landingSaleBannerSelectedProducts))
    );
  });

  test("describes a sale on every cowork product", () => {
    expect(formatLabel([coworkProduct])).toEqual(
      summerFocusLabel(bannerTemplate(m.landingSaleBannerAllCoworkProducts))
    );
  });

  test("describes a sale on every cowork tier as every cowork product", () => {
    expect(
      formatLabel([
        { kind: "cowork", tier: "open-space" },
        { kind: "cowork", tier: "reserved-desk" },
      ])
    ).toEqual(
      summerFocusLabel(bannerTemplate(m.landingSaleBannerAllCoworkProducts))
    );
  });

  test("uses the selected-products fallback for a single cowork tier", () => {
    expect(formatLabel([{ kind: "cowork", tier: "reserved-desk" }])).toEqual(
      summerFocusLabel(bannerTemplate(m.landingSaleBannerSelectedProducts))
    );
    expect(
      formatLabel([
        { kind: "cowork", tier: "open-space" },
        meetingRoomProduct,
        officeProduct,
      ])
    ).toEqual(
      summerFocusLabel(bannerTemplate(m.landingSaleBannerSelectedProducts))
    );
  });

  test("describes a sale on every meeting-room product", () => {
    expect(formatLabel([meetingRoomProduct])).toEqual(
      summerFocusLabel(
        bannerTemplate(m.landingSaleBannerAllMeetingRoomProducts)
      )
    );
  });

  test("uses the selected-products fallback for a family mix", () => {
    expect(formatLabel([coworkProduct, meetingRoomProduct])).toEqual(
      summerFocusLabel(bannerTemplate(m.landingSaleBannerSelectedProducts))
    );
  });

  test("does not omit office from a mixed sale label", () => {
    expect(formatLabel([coworkProduct, officeProduct])).toEqual(
      summerFocusLabel(bannerTemplate(m.landingSaleBannerSelectedProducts))
    );
  });
});
