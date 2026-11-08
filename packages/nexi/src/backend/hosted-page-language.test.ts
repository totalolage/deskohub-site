import { describe, expect, test } from "bun:test";
import { getLocaleDefinition } from "@deskohub/i18n/locale-registry";
import { toHostedPageLanguage } from "./hosted-page-language";

describe("toHostedPageLanguage", () => {
  test("sends a language Nexi offers in the contract's uppercase form", () => {
    expect(toHostedPageLanguage("cze")).toBe("CZE");
    expect(toHostedPageLanguage("eng")).toBe("ENG");
    expect(toHostedPageLanguage("deu")).toBe("DEU");
    expect(toHostedPageLanguage("slk")).toBe("SLK");
  });

  test("shows English for a language Nexi doesn't offer", () => {
    expect(toHostedPageLanguage("ukr")).toBe("ENG");
  });

  test("keeps the hosted page language of each current locale", () => {
    expect(
      toHostedPageLanguage(getLocaleDefinition("cs-CZ").nexiLanguage)
    ).toBe("CZE");
    expect(
      toHostedPageLanguage(getLocaleDefinition("en-US").nexiLanguage)
    ).toBe("ENG");
  });
});
