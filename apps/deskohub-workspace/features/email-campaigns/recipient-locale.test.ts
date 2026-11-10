import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { type Locale, locales } from "@/features/i18n";
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
        accountLocale: "fr-FR",
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
  const variant = (text: string) => campaignContentFixture(text)["cs-CZ"]!;
  const czech = variant("Ahoj");
  const english = variant("Hello");
  const german = variant("Hallo");
  const ukrainian = variant("Pryvit");
  const slovak = variant("Ahoj SK");
  const vietnamese = variant("Xin chao");
  const hindi = variant("Namaste");
  const everyLocale: CampaignLocalizedContent = {
    "cs-CZ": czech,
    "en-US": english,
    "de-DE": german,
    "uk-UA": ukrainian,
    "sk-SK": slovak,
    "vi-VN": vietnamese,
    "hi-IN": hindi,
  };
  const chosenLocale = (
    content: CampaignLocalizedContent,
    recipientLocale: Locale
  ) => campaignContentForRecipient(content, recipientLocale).locale;

  test("gives every recipient their own locale's content when it exists", () => {
    for (const locale of locales) {
      expect(campaignContentForRecipient(everyLocale, locale)).toEqual({
        locale,
        content: everyLocale[locale]!,
      });
    }
  });

  test("German and Ukrainian recipients fall back to English, then Czech", () => {
    for (const locale of ["de-DE", "uk-UA"] as const) {
      expect(chosenLocale({ "cs-CZ": czech, "en-US": english }, locale)).toBe(
        "en-US"
      );
      expect(chosenLocale({ "cs-CZ": czech, "sk-SK": slovak }, locale)).toBe(
        "cs-CZ"
      );
    }
  });

  test("Slovak recipients fall back to Czech, then English", () => {
    expect(chosenLocale({ "cs-CZ": czech, "en-US": english }, "sk-SK")).toBe(
      "cs-CZ"
    );
    expect(chosenLocale({ "en-US": english, "de-DE": german }, "sk-SK")).toBe(
      "en-US"
    );
  });

  test("Czech recipients fall back to English and English recipients to Czech", () => {
    expect(chosenLocale({ "en-US": english, "de-DE": german }, "cs-CZ")).toBe(
      "en-US"
    );
    expect(chosenLocale({ "cs-CZ": czech, "de-DE": german }, "en-US")).toBe(
      "cs-CZ"
    );
  });

  test("falls back to the first content locale when the chain has no content", () => {
    expect(chosenLocale({ "de-DE": german, "sk-SK": slovak }, "en-US")).toBe(
      "de-DE"
    );
  });

  test("Czech content reaches every recipient, so it covers any audience", () => {
    for (const locale of locales) {
      expect(chosenLocale({ "cs-CZ": czech }, locale)).toBe("cs-CZ");
    }
  });
});
