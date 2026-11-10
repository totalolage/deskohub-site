import type { PostHogFeatureFlagSnapshot } from "@deskohub/posthog/feature-flags";

/** Generated from PostHog feature flag definitions. Do not edit manually. */
export const postHogFeatureFlagSnapshot = {
  generatedAt: "2026-11-09T17:55:21.737Z",
  constantValues: {
    "account_avatars": null,
    "calendar_sales": true,
    "customer_discounts": false,
    "discount_codes": true,
    "login_email_code": true,
    "login_passkeys": true,
    "meeting_room_page": true,
    "office_page": false,
    "referrals": false,
    "seating_map": false,
    "webmcp_site_tools": false,
  },
} as const satisfies PostHogFeatureFlagSnapshot;
