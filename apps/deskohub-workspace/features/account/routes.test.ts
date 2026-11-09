import { describe, expect, test } from "bun:test";
import {
  findAccountSectionOfPathname,
  findLegacyAccountSectionRedirect,
  getAccountSectionPath,
  getAccountSignInPath,
  getAuthVerifyPath,
  getNoLongerWaitingSignInPath,
  parseSignInPurpose,
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

describe("auth page paths", () => {
  test("keeps the plain sign-in path without a return path", () => {
    expect(getAccountSignInPath("cs-CZ")).toBe("/cs-CZ/auth/sign-in");
  });

  test("carries a return path in the sign-in path's query", () => {
    const url = new URL(
      getAccountSignInPath("en-US", "/en-US/reservation?date=2026-10-20"),
      "https://site.invalid"
    );

    expect(url.pathname).toBe("/en-US/auth/sign-in");
    expect(url.searchParams.get("returnTo")).toBe(
      "/en-US/reservation?date=2026-10-20"
    );
  });

  test("names the sign-in purpose next to the return path", () => {
    const url = new URL(
      getAccountSignInPath(
        "en-US",
        "/en-US/reservation/status/order-1?outcome=success",
        "reservation"
      ),
      "https://site.invalid"
    );

    expect(url.pathname).toBe("/en-US/auth/sign-in");
    expect(url.searchParams.get("returnTo")).toBe(
      "/en-US/reservation/status/order-1?outcome=success"
    );
    expect(url.searchParams.get("for")).toBe("reservation");
  });

  test("returns an assistant connection to its full request", () => {
    const returnTo =
      "/cs-CZ/auth/connect?client_id=https%3A%2F%2Fassistant.invalid%2Fclient.json&scope=offerings%3Aread&signed_in=1";
    const url = new URL(
      getAccountSignInPath("cs-CZ", returnTo, "assistant"),
      "https://site.invalid"
    );

    expect(url.pathname).toBe("/cs-CZ/auth/sign-in");
    expect(url.searchParams.get("returnTo")).toBe(returnTo);
    expect(url.searchParams.get("for")).toBe("assistant");
  });

  test("names the sign-in purpose without a return path", () => {
    expect(getAccountSignInPath("cs-CZ", undefined, "reservation")).toBe(
      "/cs-CZ/auth/sign-in?for=reservation"
    );
  });

  test.each(["https://evil.invalid/en-US/account", "//evil.invalid/x"])(
    "keeps the sign-in purpose when it leaves out the return path %s",
    (returnTo) => {
      expect(getAccountSignInPath("en-US", returnTo, "reservation")).toBe(
        "/en-US/auth/sign-in?for=reservation"
      );
    }
  );

  test("reads only a known sign-in purpose", () => {
    expect(parseSignInPurpose("reservation")).toBe("reservation");
    expect(parseSignInPurpose("assistant")).toBe("assistant");
    expect(parseSignInPurpose("account")).toBeUndefined();
    expect(parseSignInPurpose("")).toBeUndefined();
    expect(parseSignInPurpose(null)).toBeUndefined();
    expect(parseSignInPurpose(undefined)).toBeUndefined();
  });

  test("builds the verify path for the locale", () => {
    expect(getAuthVerifyPath("en-US")).toBe("/en-US/auth/verify");
  });

  test("builds the plain sign-in path with the no-longer-waiting notice", () => {
    expect(getNoLongerWaitingSignInPath("cs-CZ")).toBe(
      "/cs-CZ/auth/sign-in?notice=no-longer-waiting"
    );
  });
});
