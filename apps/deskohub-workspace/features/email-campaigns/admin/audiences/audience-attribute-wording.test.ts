import { describe, expect, test } from "bun:test";
import {
  getLocaleDefinition,
  supportedLocales,
} from "@deskohub/i18n/locale-registry";
import { audienceAttributeWording } from "./audience-attribute-wording";

describe("audience locale options", () => {
  test("offers every Workspace language, named in itself with its tag", () => {
    const wording = audienceAttributeWording("locale", "cs-CZ");
    if (wording?.kind !== "set" || wording.values._tag !== "Options") {
      throw new Error("the locale attribute offers options");
    }
    expect(Object.keys(wording.values.options)).toEqual([...supportedLocales]);
    for (const option of supportedLocales) {
      const label = wording.values.options[option]?.label ?? "";
      expect(label).toContain(getLocaleDefinition(option).nativeName);
      expect(label).toContain(option);
    }
  });
});
