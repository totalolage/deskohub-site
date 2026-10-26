import { describe, expect, mock, test } from "bun:test";
import { locales, m } from "@/features/i18n";

mock.module("server-only", () => ({}));

const { privateOrderPage } = await import("./private-order-page.server");

const notFound = "NEXT_HTTP_ERROR_FALLBACK;404";

const orderPage = privateOrderPage({
  title: m.checkoutStatusMetadataTitle,
  description: m.checkoutStatusMetadataDescription,
});

const routeParams = (locale: string, orderId: string) =>
  // The `[locale]` segment's parameter reaches every page under it.
  Promise.resolve({ locale, orderId });

describe("privateOrderPage", () => {
  for (const locale of locales) {
    test(`keeps the ${locale} order page out of search results and referrers`, async () => {
      const metadata = await orderPage.generateMetadata({
        params: routeParams(locale, "order-1"),
      });

      expect(metadata.robots).toEqual({ index: false, follow: false });
      expect(metadata.referrer).toBe("no-referrer");
      // A noindexed page names no canonical, hreflang or Open Graph URL.
      expect(metadata.alternates).toBeUndefined();
      expect(metadata.openGraph?.url).toBeUndefined();
      expect(metadata.title).toBe(
        m.checkoutStatusMetadataTitle({}, { locale })
      );
    });
  }

  test("reads the order ID from the route parameters", async () => {
    await expect(
      orderPage.readOrderId(routeParams("en-US", "order-1"))
    ).resolves.toBe("order-1");
  });

  test("is not found for a malformed order ID", async () => {
    await expect(
      orderPage.readOrderId(routeParams("en-US", ""))
    ).rejects.toThrow(notFound);
    await expect(
      orderPage.generateMetadata({ params: routeParams("en-US", "") })
    ).rejects.toThrow(notFound);
  });
});
