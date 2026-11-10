import { describe, expect, test } from "bun:test";
import {
  getLocaleDefinition,
  supportedLocales,
} from "@deskohub/i18n/locale-registry";
import {
  campaignLocaleName,
  describeCampaignLocales,
} from "./campaign-locale-names";

const nativeName = (locale: (typeof supportedLocales)[number]) =>
  getLocaleDefinition(locale).nativeName;

describe("campaign locale names", () => {
  test("names every campaign language as the registry does", () => {
    for (const locale of supportedLocales) {
      expect(campaignLocaleName(locale)).toBe(nativeName(locale));
    }
  });

  test("lists content languages in the order given", () => {
    expect(describeCampaignLocales(["cs-CZ", "en-US"])).toBe(
      `${nativeName("cs-CZ")}, ${nativeName("en-US")}`
    );
    expect(describeCampaignLocales(["en-US", "cs-CZ"])).toBe(
      `${nativeName("en-US")}, ${nativeName("cs-CZ")}`
    );
  });
});
