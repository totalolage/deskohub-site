import { describe, expect, test } from "bun:test";
import { supportedLocales } from "@deskohub/i18n/locale-registry";
import { CustomerLocale } from "./customer-locale";

describe("CustomerLocale", () => {
  test("accepts exactly the supported locales", () => {
    expect(CustomerLocale.literals).toEqual(supportedLocales);
  });
});
