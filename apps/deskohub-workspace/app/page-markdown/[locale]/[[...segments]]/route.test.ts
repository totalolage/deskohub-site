import "@/shared/testing/workspace-test-env";

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import { advertisedCatalogOfferings } from "@/features/checkout/public-offerings.test-utils";
import { DiscountReleaseGateService } from "@/features/discounts/discount-release-gate.service";
import type { Locale } from "@/features/i18n";
import { getLegalDocument } from "@/features/legal/content";
import { OfficeReservationFeatureFlagService } from "@/features/office/backend/office-reservation-feature-flag.service";
import { type PublicPage, publicPages } from "@/features/public-pages";
import { PublishedPublicPagesService } from "@/features/public-pages/backend";
import { publicPageMarkdown } from "@/features/public-pages/public-page-markdown";

// Outside a Next.js render there is no cache to configure.
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({ ...nextCache, cacheLife: () => {} }));

// The FAQ's occupancy loader has its own tests; keep this one off Dotypos.
mock.module("@/features/faq/backend/faq-occupancy.server", () => ({
  loadFaqOccupancyStats: () =>
    Promise.resolve({ averageReservationsPerDay: 3, coworkSeatCapacity: 8 }),
}));

// Advertised pricing has its own tests; here every offering is at its
// catalog price, and the office is listed only while its gate is open.
mock.module("@/features/checkout/backend/checkout/public-offerings", () => ({
  loadPublicPriceList: (locale: Locale) =>
    Effect.gen(function* () {
      const officeFlag = yield* OfficeReservationFeatureFlagService;
      const officeOpen = yield* officeFlag.isEnabled;
      return {
        advertisedOn: Temporal.Now.plainDateISO(),
        offerings: advertisedCatalogOfferings({
          locale,
          ...(officeOpen && { office: {} }),
        }),
        complete: true,
      };
    }),
}));

// The service's own tests cover release-gate evaluation; here it reports
// which pages are published.
let publishedPages: ReadonlyArray<PublicPage> = publicPages;
const originalLive = PublishedPublicPagesService.Live;
Object.assign(PublishedPublicPagesService, {
  Live: Layer.succeed(PublishedPublicPagesService, {
    list: Effect.sync(() => publishedPages),
  }),
});
// The gate service's own tests cover evaluation; here no discount is
// released, so no sale is looked up.
const originalGatesLive = DiscountReleaseGateService.Live;
Object.assign(DiscountReleaseGateService, {
  Live: DiscountReleaseGateService.fromDecisions({
    calendarSales: false,
    customerDiscounts: false,
    discountCodes: false,
  }),
});
afterAll(() => {
  Object.assign(PublishedPublicPagesService, { Live: originalLive });
  Object.assign(DiscountReleaseGateService, { Live: originalGatesLive });
});

const { GET } = await import("./route");

beforeEach(() => {
  publishedPages = publicPages;
});

const getMarkdown = (locale: string, segments?: ReadonlyArray<string>) =>
  GET(
    new Request(
      `https://workspace.example/page-markdown/${locale}/${(segments ?? []).join("/")}`,
      { headers: { accept: "text/markdown" } }
    ),
    { params: Promise.resolve({ locale, ...(segments && { segments }) }) }
  );

describe("public page Markdown route", () => {
  test.each([
    ["en-US", undefined, "https://workspace.deskohub.cz/en-US"],
    ["cs-CZ", ["contact"], "https://workspace.deskohub.cz/cs-CZ/contact"],
    [
      "en-US",
      ["reservation", "cowork"],
      "https://workspace.deskohub.cz/en-US/reservation/cowork",
    ],
  ])(
    "serves %s %p as Markdown naming its HTML page",
    async (locale, segments, canonical) => {
      const response = await getMarkdown(locale, segments);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(
        "text/markdown; charset=utf-8"
      );
      expect(response.headers.get("vary")).toBe("Accept");
      expect(response.headers.get("link")).toBe(
        `<${canonical}>; rel="canonical"`
      );
      expect(response.headers.get("x-robots-tag")).toBe("noindex");
      expect(await response.text()).toMatch(/^# /);
    }
  );

  test.each(["en-US", "cs-CZ"] as const)(
    "renders a legal page from its %s document",
    async (locale) => {
      const response = await getMarkdown(locale, ["privacy-policy"]);
      const document = getLegalDocument(locale, "privacy-policy");

      expect(await response.text()).toStartWith(`# ${document.title}\n`);
    }
  );

  test("renders every page of the registry in every locale", async () => {
    for (const { pathname } of publicPages) {
      for (const locale of ["en-US", "cs-CZ"] as const) {
        const segments = pathname.split("/").filter(Boolean);
        const response = await getMarkdown(
          locale,
          segments.length > 0 ? segments : undefined
        );
        expect(response.status).toBe(200);
        expect(publicPageMarkdown[pathname]).toBeDefined();
      }
    }
  });

  test("has no Markdown for a gated page production does not serve", async () => {
    publishedPages = publicPages.filter(
      ({ pathname }) => pathname !== "/meeting-room"
    );

    const response = await getMarkdown("en-US", ["meeting-room"]);

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type") ?? "").not.toContain(
      "markdown"
    );
  });

  test.each([
    ["en-US", ["account"]],
    ["en-US", ["checkout", "pay"]],
    [
      "en-US",
      ["reservation", "status", "019edbcf-5026-7ecc-821b-eda46998eaaa"],
    ],
    ["en-US", ["admin"]],
    ["en-US", ["gallery"]],
    ["en-US", ["testing"]],
    ["de-DE", ["contact"]],
  ])(
    "has no Markdown for %s %p, which is not a public page",
    async (locale, segments) => {
      const response = await getMarkdown(locale, segments);

      expect(response.status).toBe(404);
      expect(response.headers.get("x-robots-tag")).toBe("noindex");
    }
  );
});
