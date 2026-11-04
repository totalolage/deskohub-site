import { describe, expect, test } from "bun:test";
import { baseLocale } from "../../features/i18n";
import { cookieName } from "../../features/i18n/paraglide/runtime.js";
import {
  createLocaleRedirectResponse,
  resolveRequestLocale,
} from "./locale-routing";

test("locale redirect keeps campaign query parameters", () => {
  const search = "?utm_source=newsletter&utm_campaign=launch&gclid=abc";
  const response = createLocaleRedirectResponse(
    new Request(`https://www.deskohub.cz/${search}`)
  );

  const location = response.headers.get("location");
  expect(location).not.toBeNull();
  expect(new URL(location ?? "").search).toBe(search);
});

const requestWith = (headers: Record<string, string>) =>
  new Request("https://www.deskohub.cz/", { headers });

describe("resolveRequestLocale", () => {
  test("prefers the locale cookie among other cookies", () => {
    const request = requestWith({
      cookie: `theme=dark; ${cookieName}=en-US; session=a=b`,
      "accept-language": "cs-CZ",
    });

    expect(resolveRequestLocale(request)).toBe("en-US");
  });

  test("falls back to the browser language when the cookie locale is empty or unknown", () => {
    for (const cookie of [
      `${cookieName}=`,
      `${cookieName}=de-DE`,
      `${cookieName}=en-US=x`,
    ]) {
      const request = requestWith({ cookie, "accept-language": "en-US" });

      expect(resolveRequestLocale(request)).toBe("en-US");
    }
  });

  test("uses the browser language without a locale cookie", () => {
    expect(
      resolveRequestLocale(
        requestWith({ cookie: "theme=dark", "accept-language": "en-US" })
      )
    ).toBe("en-US");
    expect(
      resolveRequestLocale(requestWith({ "accept-language": "en-US,cs;q=0.5" }))
    ).toBe("en-US");
  });

  test("uses the base locale when neither cookie nor browser language names one", () => {
    expect(
      resolveRequestLocale(requestWith({ "accept-language": "de-DE" }))
    ).toBe(baseLocale);
    expect(resolveRequestLocale(requestWith({}))).toBe(baseLocale);
  });

  test("remembers the resolved locale in the redirect cookie", () => {
    const response = createLocaleRedirectResponse(
      requestWith({ "accept-language": "en-US" })
    );

    expect(new URL(response.headers.get("location") ?? "").pathname).toBe(
      "/en-US/"
    );
    expect(response.headers.get("set-cookie")).toStartWith(
      `${cookieName}=en-US;`
    );
  });
});
