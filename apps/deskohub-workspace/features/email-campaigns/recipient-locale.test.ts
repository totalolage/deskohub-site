import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { locales } from "@/features/i18n";
import type { AudienceFilter } from "./audience-filter";
import { campaignContentFixture } from "./backend/email-campaigns.test-utils";
import type { CampaignLocalizedContent } from "./body/campaign-content";
import {
  campaignContentCoversAudience,
  campaignContentForRecipient,
  campaignContentLocales,
  campaignLocaleEntries,
  campaignLocales,
  resolveRecipientLocale,
} from "./recipient-locale";

describe("resolveRecipientLocale", () => {
  const none = {
    accountLocale: null,
    latestReservationLocale: null,
    consentLocale: null,
  };

  test("prefers the account, then the latest reservation, then the consent", () => {
    expect(
      resolveRecipientLocale({
        accountLocale: "en-US",
        latestReservationLocale: "cs-CZ",
        consentLocale: "cs-CZ",
      })
    ).toBe("en-US");
    expect(
      resolveRecipientLocale({
        ...none,
        latestReservationLocale: "en-US",
        consentLocale: "cs-CZ",
      })
    ).toBe("en-US");
    expect(resolveRecipientLocale({ ...none, consentLocale: "en-US" })).toBe(
      "en-US"
    );
  });

  test("skips unsupported values and falls back to Czech", () => {
    expect(
      resolveRecipientLocale({
        accountLocale: "de-DE",
        latestReservationLocale: "en",
        consentLocale: null,
      })
    ).toBe("cs-CZ");
    expect(resolveRecipientLocale(none)).toBe("cs-CZ");
  });
});

describe("campaignContentCoversAudience", () => {
  const czechOnly = campaignContentFixture();
  const englishOnly = { "en-US": czechOnly["cs-CZ"] };
  const audience = (
    locales: Extract<AudienceFilter, { readonly attribute: "locale" }>["value"]
  ) =>
    Option.some<AudienceFilter>({
      attribute: "locale",
      _tag: "Condition",
      operator: "anyOf",
      value: locales,
    });

  test("accepts Czech content for any audience", () => {
    expect(
      campaignContentCoversAudience({
        content: czechOnly,
        audienceFilter: Option.none(),
      })
    ).toBe(true);
    expect(
      campaignContentCoversAudience({
        content: czechOnly,
        audienceFilter: audience(["en-US"]),
      })
    ).toBe(true);
  });

  test("rejects English-only content for an audience that can reach Czech fallback recipients", () => {
    for (const audienceFilter of [
      Option.none(),
      audience(["cs-CZ", "en-US"]),
      audience(["cs-CZ"]),
    ]) {
      expect(
        campaignContentCoversAudience({ content: englishOnly, audienceFilter })
      ).toBe(false);
    }
  });

  test("accepts English-only content for an English-only audience", () => {
    const english: AudienceFilter = {
      attribute: "locale",
      _tag: "Condition",
      operator: "anyOf",
      value: ["en-US"],
    };
    for (const audienceFilter of [
      audience(["en-US"]),
      Option.some<AudienceFilter>({
        _tag: "Group",
        operator: "and",
        filters: [{ _tag: "Group", operator: "and", filters: [english] }],
      }),
      Option.some<AudienceFilter>({
        _tag: "Group",
        operator: "or",
        filters: [english],
      }),
    ]) {
      expect(
        campaignContentCoversAudience({ content: englishOnly, audienceFilter })
      ).toBe(true);
    }
  });
});

describe("campaign content locales", () => {
  const czech = campaignContentFixture("Ahoj")["cs-CZ"]!;
  const english = campaignContentFixture("Hello")["cs-CZ"]!;
  const bilingual: CampaignLocalizedContent = {
    "cs-CZ": czech,
    "en-US": english,
  };

  test("lists content in the runtime locale order, whatever the record's key order", () => {
    const reordered: CampaignLocalizedContent = Object.fromEntries(
      [...locales].reverse().map((locale) => [locale, czech])
    );

    expect(campaignContentLocales(reordered)).toEqual(locales);
    expect(campaignLocaleEntries(reordered).map(([locale]) => locale)).toEqual(
      locales
    );
  });

  test("lists display order with the Czech fallback first", () => {
    expect(campaignLocales[0]).toBe("cs-CZ");
    expect(
      campaignLocaleEntries(bilingual, campaignLocales).map(
        ([locale]) => locale
      )
    ).toEqual(["cs-CZ", "en-US"]);
  });

  test("leaves out locales without content", () => {
    expect(campaignContentLocales({ "en-US": english })).toEqual(["en-US"]);
    expect(campaignLocaleEntries({}, campaignLocales)).toEqual([]);
  });
});

describe("campaignContentForRecipient", () => {
  const czech = campaignContentFixture("Ahoj")["cs-CZ"]!;
  const english = campaignContentFixture("Hello")["cs-CZ"]!;

  test("gives recipients their own locale's content when it exists", () => {
    expect(
      campaignContentForRecipient({ "cs-CZ": czech, "en-US": english }, "en-US")
    ).toEqual({ locale: "en-US", content: english });
  });

  test("falls back to Czech for a locale without content", () => {
    expect(campaignContentForRecipient({ "cs-CZ": czech }, "en-US")).toEqual({
      locale: "cs-CZ",
      content: czech,
    });
  });

  test("falls back to the only locale when Czech is missing", () => {
    expect(campaignContentForRecipient({ "en-US": english }, "cs-CZ")).toEqual({
      locale: "en-US",
      content: english,
    });
  });
});
