import PostHog from "posthog-react-native";

type ShopAnalyticsEvent =
  | "shop_magic_link_requested"
  | "shop_signed_in"
  | "shop_catalog_refreshed"
  | "shop_quote_confirmed"
  | "shop_payment_started"
  | "shop_payment_reconciled";

let client: PostHog | null = null;

async function getOrCreateClient(): Promise<PostHog | null> {
  const projectToken = process.env.EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim();
  if (!projectToken) return null;
  if (!client) {
    client = new PostHog(projectToken, {
      host:
        process.env.EXPO_PUBLIC_POSTHOG_HOST?.trim() ||
        "https://us.i.posthog.com",
      defaultOptIn: false,
      captureAppLifecycleEvents: false,
      enableSessionReplay: false,
    });
    await client.ready();
  }
  return client;
}

export const shopAnalytics = {
  async setConsent(allowed: boolean) {
    try {
      if (!allowed) {
        if (client) {
          await client.optOut();
          client.reset();
        }
        return;
      }
      const nextClient = await getOrCreateClient();
      await nextClient?.optIn();
    } catch {
      // Analytics must never interfere with shopping or payment.
    }
  },
  capture(
    event: ShopAnalyticsEvent,
    properties: Readonly<Record<string, string | number | boolean>> = {}
  ) {
    client?.capture(event, properties);
  },
};
