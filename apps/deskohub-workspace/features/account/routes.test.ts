import { describe, expect, test } from "bun:test";
import {
  findAccountSectionOfPathname,
  findLegacyAccountSectionRedirect,
  getAccountSectionPath,
} from "./routes";
import { accountSections } from "./sections";

describe("account section paths", () => {
  test.each(accountSections.map((section) => [section] as const))(
    "opens %s at its own path under the account",
    (section) => {
      expect(getAccountSectionPath("cs-CZ", section)).toBe(
        `/cs-CZ/account/${section}`
      );
    }
  );

  test.each(accountSections.map((section) => [section] as const))(
    "reads %s back from its path, with or without a trailing slash",
    (section) => {
      const path = getAccountSectionPath("en-US", section);

      expect(findAccountSectionOfPathname("en-US", path)).toBe(section);
      expect(findAccountSectionOfPathname("en-US", `${path}/`)).toBe(section);
    }
  );

  test("shows the default section on the bare account path", () => {
    expect(findAccountSectionOfPathname("en-US", "/en-US/account")).toBe(
      "reservations"
    );
    expect(findAccountSectionOfPathname("cs-CZ", "/cs-CZ/account/")).toBe(
      "reservations"
    );
  });

  test.each([
    "/en-US/account/deleted",
    "/en-US/account/unknown",
    "/en-US/account/profile/extra",
    "/en-US/accounts",
    "/cs-CZ/account/profile",
    "/en-US/reservation/status/order-1",
  ])("finds no section at %s", (pathname) => {
    expect(findAccountSectionOfPathname("en-US", pathname)).toBeUndefined();
  });
});

describe("legacy account section links", () => {
  const redirect = (url: string, locale: "en-US" | "cs-CZ" = "en-US") =>
    findLegacyAccountSectionRedirect(locale, new URL(url))?.href;

  test.each(accountSections.map((section) => [section] as const))(
    "moves ?section=%s to the section's path",
    (section) => {
      expect(
        redirect(
          `https://workspace.example/cs-CZ/account?section=${section}`,
          "cs-CZ"
        )
      ).toBe(`https://workspace.example/cs-CZ/account/${section}`);
    }
  );

  test("keeps other query parameters and the fragment", () => {
    expect(
      redirect(
        "https://workspace.example/en-US/account/?utm_source=email&section=security&ref=RFL12345#passkeys"
      )
    ).toBe(
      "https://workspace.example/en-US/account/security?utm_source=email&ref=RFL12345#passkeys"
    );
  });

  test("lets the first of repeated section parameters decide", () => {
    expect(
      redirect(
        "https://workspace.example/en-US/account?section=billing&section=profile"
      )
    ).toBe("https://workspace.example/en-US/account/billing");
  });

  test.each(["unknown", "", "Profile", "deleted"])(
    "leads the unknown section %p to the account itself",
    (section) => {
      expect(
        redirect(
          `https://workspace.example/en-US/account?section=${section}&ref=RFL12345`
        )
      ).toBe("https://workspace.example/en-US/account?ref=RFL12345");
    }
  );

  test.each([
    "https://workspace.example/en-US/account",
    "https://workspace.example/en-US/account?ref=RFL12345",
    "https://workspace.example/en-US/account/profile?section=billing",
    "https://workspace.example/en-US/account/legal?section=profile",
    "https://workspace.example/en-US/faq?section=profile",
    "https://workspace.example/cs-CZ/account?section=profile",
  ])("leaves %s alone", (url) => {
    expect(redirect(url)).toBeUndefined();
  });
});
