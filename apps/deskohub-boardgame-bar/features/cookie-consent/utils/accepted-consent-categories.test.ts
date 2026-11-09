import { describe, expect, test } from "bun:test";
import type CookieConsent from "vanilla-cookieconsent";
import { acceptedConsentCategories } from "./accepted-consent-categories";

describe("acceptedConsentCategories", () => {
  test("lists the categories the visitor accepted", () => {
    expect(
      acceptedConsentCategories({
        acceptedCategories: ["necessary", "analytics"],
      })
    ).toEqual(["necessary", "analytics"]);
  });

  test("lists none before the banner has stored a choice", () => {
    expect(acceptedConsentCategories(undefined)).toEqual([]);
    expect(
      acceptedConsentCategories(
        {} as Pick<CookieConsent.UserPreferences, "acceptedCategories">
      )
    ).toEqual([]);
  });
});
