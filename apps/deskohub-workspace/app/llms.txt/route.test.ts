import "@/shared/testing/workspace-test-env";

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Layer, Option } from "effect";
import { advertisedCatalogOfferings } from "@/features/checkout/public-offerings.test-utils";
import { DiscountReleaseGateService } from "@/features/discounts/discount-release-gate.service";
import { WorkspaceFeatureFlagService } from "@/features/feature-flags/backend";
import type { Locale } from "@/features/i18n";
import { OfficeReleaseGate } from "@/features/office/backend/office-release-gate";
import { PublishedPublicPagesService } from "@/features/public-pages/backend";
import {
  type PublicPage,
  publicPages,
} from "@/features/public-pages/public-page-definitions";
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
      const officeOpen = yield* OfficeReleaseGate.isOpen;
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
// The release gate's own tests cover the release; here the site tools are
// on for every visitor.
const originalFeatureFlagsDefault = WorkspaceFeatureFlagService.Default;
Object.assign(WorkspaceFeatureFlagService, {
  Default: WorkspaceFeatureFlagService.from({
    evaluateFlags: () => Effect.die("evaluateFlags should not be called"),
    isEnabled: (key) => Effect.die(`isEnabled(${key}) should not be called`),
    constantValue: (key) =>
      key === "webmcp_site_tools"
        ? Effect.succeed(Option.some(true))
        : Effect.die(`constantValue(${key}) should not be called`),
  }),
});
afterAll(() => {
  Object.assign(PublishedPublicPagesService, { Live: originalLive });
  Object.assign(DiscountReleaseGateService, { Live: originalGatesLive });
  Object.assign(WorkspaceFeatureFlagService, {
    Default: originalFeatureFlagsDefault,
  });
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
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
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
    "/logo",
    "/testing",
  ])("never links %s", async (pathname) => {
    const urls = markdownLinkUrls(await (await getLlmsTxt()).text());

    expect(urls.some((url) => new URL(url).pathname.includes(pathname))).toBe(
      false
    );
  });
});
