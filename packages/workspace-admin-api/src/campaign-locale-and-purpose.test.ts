import { describe, expect, test } from "bun:test";
import { supportedLocales } from "@deskohub/i18n/locale-registry";
import { AdministrationCampaignLocale } from "./campaign-locale-and-purpose";

describe("AdministrationCampaignLocale", () => {
  test("accepts exactly the supported locales", () => {
    expect(AdministrationCampaignLocale.literals).toEqual(supportedLocales);
  });
});
