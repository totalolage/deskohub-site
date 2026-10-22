import "@/shared/testing/workspace-test-env";

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import { SiteToolsFeatureFlagService } from "@/features/agent-tools/site-tools-feature-flag.service";
import { advertisedCatalogOfferings } from "@/features/checkout/public-offerings.test-utils";
import { DiscountReleaseGateService } from "@/features/discounts/discount-release-gate.service";
import type { Locale } from "@/features/i18n";
import { OfficeReservationFeatureFlagService } from "@/features/office/backend/office-reservation-feature-flag.service";
import { type PublicPage, publicPages } from "@/features/public-pages";
import { PublishedPublicPagesService } from "@/features/public-pages/backend";
import { markdownLinkUrls } from "@/shared/markdown/markdown.test-utils";

// Outside a Next.js render there is no cache to configure.
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({ ...nextCache, cacheLife: () => {} }));

// Advertised pricing has its own tests; here every offering is at its
// catalog price, and the office is listed only while its gate is open.
const publicOfferings = await import(
  "@/features/checkout/backend/checkout/public-offerings"
);
mock.module("@/features/checkout/backend/checkout/public-offerings", () => ({
  ...publicOfferings,
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
// The flag service's own tests cover the release; here the site tools are
// on for every visitor.
const originalSiteToolsLive = SiteToolsFeatureFlagService.Live;
Object.assign(SiteToolsFeatureFlagService, {
  Live: Layer.succeed(SiteToolsFeatureFlagService, {
    isEnabled: Effect.succeed(true),
    release: Effect.succeed("on"),
  }),
});
afterAll(() => {
  Object.assign(PublishedPublicPagesService, { Live: originalLive });
  Object.assign(DiscountReleaseGateService, { Live: originalGatesLive });
  Object.assign(SiteToolsFeatureFlagService, { Live: originalSiteToolsLive });
});

const { GET } = await import("./route");

beforeEach(() => {
  publishedPages = publicPages;
});

const getLlmsTxt = () => GET(new Request("https://workspace.example/llms.txt"));

describe("/llms.txt", () => {
  test("serves the published pages as plain text", async () => {
    const response = await getLlmsTxt();
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8"
    );
    expect(body).toStartWith("# Deskohub Workspace\n");
    expect(markdownLinkUrls(body)).toContain(
      "https://workspace.deskohub.cz/reservation/office"
    );
  });

  test("leaves out gated pages production does not serve, and their offers", async () => {
    publishedPages = publicPages.filter(
      ({ releaseGate }: PublicPage) => releaseGate === undefined
    );
    const office = advertisedCatalogOfferings({
      locale: "en-US",
      office: {},
    }).find(({ kind }) => kind === "office");

    const body = await (await getLlmsTxt()).text();
    const listed = markdownLinkUrls(body)
      .filter((url) => url.startsWith("https://"))
      .map((url) => new URL(url).pathname);

    expect(listed).not.toContain("/meeting-room");
    expect(listed).not.toContain("/reservation/office");
    expect(listed).toContain("/reservation/meeting-room");
    expect(body).not.toContain(office?.name ?? "office offer");
  });

  test.each([
    "/account",
    "/checkout/pay",
    "/reservation/status",
    "/admin",
    "/gallery",
    "/testing",
  ])("never links %s", async (pathname) => {
    const urls = markdownLinkUrls(await (await getLlmsTxt()).text());

    expect(urls.some((url) => new URL(url).pathname.includes(pathname))).toBe(
      false
    );
  });
});
