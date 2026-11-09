import { describe, expect, test } from "bun:test";
import { CustomerViewError } from "./customer-view-error";
import { sharedViewErrorMessage } from "./customer-view-error-message";

const locales = ["en-US", "cs-CZ"] as const;

// biome-ignore format: the case table stays one row per line on purpose.
const shared: ReadonlyArray<CustomerViewError> = [
  CustomerViewError.SessionRequired(),
  CustomerViewError.RateLimited(),
  CustomerViewError.Unavailable(),
  CustomerViewError.TimedOut(),
  CustomerViewError.Unconfirmed(),
  CustomerViewError.Unexpected(),
  CustomerViewError.LinkRequired({ reason: "profile-missing" }),
  CustomerViewError.LinkRequired({ reason: "support-required" }),
  CustomerViewError.LinkRequired({ reason: "deletion-pending" }),
];

// biome-ignore format: the case table stays one row per line on purpose.
const screenOwned: ReadonlyArray<CustomerViewError> = [
  CustomerViewError.FeatureUnavailable({ feature: "referrals" }),
  CustomerViewError.NotFound(),
  CustomerViewError.AccessCodeUnavailable(),
  CustomerViewError.InvoiceNotIssued(),
  CustomerViewError.AvatarRejected({ reason: "unsupported-format" }),
  CustomerViewError.MarketingPreferencesStale(),
  CustomerViewError.AuthRejected({ reason: "forbidden", code: undefined }),
];

describe("sharedViewErrorMessage", () => {
  test("words every shared failure in both locales, each differently", () => {
    for (const locale of locales) {
      const messages = shared.map((error) =>
        sharedViewErrorMessage(error, locale)
      );

      expect(messages.every((message) => (message ?? "").length > 0)).toBe(
        true
      );
      expect(new Set(messages).size).toBe(messages.length);
    }
  });

  test("leaves screen-specific failures to the screen", () => {
    for (const error of screenOwned) {
      expect(sharedViewErrorMessage(error, "en-US")).toBeUndefined();
    }
  });
});
