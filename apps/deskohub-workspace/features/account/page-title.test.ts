import { describe, expect, test } from "bun:test";
import { getAccountPageTitle } from "@/features/account/page-title";
import {
  accountSections,
  isAccountPageSection,
} from "@/features/account/sections";

describe("getAccountPageTitle", () => {
  test("titles the bare account page after the account", () => {
    expect(getAccountPageTitle("en-US")).toBe(
      "My account | Deskohub Workspace"
    );
    expect(getAccountPageTitle("cs-CZ")).toBe("Můj účet | Deskohub Workspace");
  });

  test("titles each section's page after the section's navigation label", () => {
    expect(getAccountPageTitle("en-US", "security")).toBe(
      "Sign-in & security | My account | Deskohub Workspace"
    );
    expect(getAccountPageTitle("cs-CZ", "security")).toBe(
      "Přihlášení a zabezpečení | Můj účet | Deskohub Workspace"
    );
  });

  test("gives every section its own title", () => {
    for (const locale of ["en-US", "cs-CZ"] as const) {
      const titles = accountSections
        .filter(isAccountPageSection)
        .map((section) => getAccountPageTitle(locale, section));

      expect(new Set([...titles, getAccountPageTitle(locale)]).size).toBe(
        titles.length + 1
      );
    }
  });
});
