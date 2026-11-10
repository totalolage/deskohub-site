import { describe, expect, test } from "bun:test";
import { resolveWorkspaceLocale } from "./locale-resolution";
import { localeCookieName } from "./routing";

const sources = ({
  pathname,
  cookie,
  acceptLanguage,
}: {
  readonly pathname?: string;
  readonly cookie?: string;
  readonly acceptLanguage?: string;
}) => {
  const headers = new Headers();
  if (acceptLanguage) headers.set("accept-language", acceptLanguage);

  return {
    pathname,
    cookies: {
      get: (name: string) =>
        name === localeCookieName && cookie ? { value: cookie } : undefined,
    },
    headers,
  };
};

describe("Workspace locale resolution", () => {
  test("the saved preference outranks the URL, cookie, and Accept-Language", () => {
    expect(
      resolveWorkspaceLocale(
        sources({
          pathname: "/en-US/account",
          cookie: "en-US",
          acceptLanguage: "en-US,en;q=0.9",
        }),
        "cs-CZ"
      )
    ).toBe("cs-CZ");
  });

  test("without a saved preference the URL path locale wins", () => {
    expect(
      resolveWorkspaceLocale(
        sources({
          pathname: "/cs-CZ/account",
          cookie: "en-US",
          acceptLanguage: "en-US",
        }),
        undefined
      )
    ).toBe("cs-CZ");
  });

  test("without a saved preference or URL locale the cookie wins", () => {
    expect(
      resolveWorkspaceLocale(
        sources({
          pathname: "/account",
          cookie: "cs-CZ",
          acceptLanguage: "en-US",
        }),
        undefined
      )
    ).toBe("cs-CZ");
  });

  test("Accept-Language follows the cookie, and the default comes last", () => {
    expect(
      resolveWorkspaceLocale(
        sources({ pathname: "/", acceptLanguage: "cs;q=0.9,de;q=0.8" }),
        undefined
      )
    ).toBe("cs-CZ");
    expect(
      resolveWorkspaceLocale(
        sources({ cookie: "fr-FR", acceptLanguage: "ru" }),
        undefined
      )
    ).toBe("en-US");
  });

  test("a request that states no language falls back to Czech", () => {
    for (const acceptLanguage of [undefined, "", "*", "en;q=0"]) {
      expect(
        resolveWorkspaceLocale(
          sources({ pathname: "/", acceptLanguage }),
          undefined
        )
      ).toBe("cs-CZ");
    }
  });

  test("a browser language finds the locale of its language", () => {
    for (const [acceptLanguage, locale] of [
      ["en-GB", "en-US"],
      ["cs-SK", "cs-CZ"],
      ["en-GB,cs;q=0.5", "en-US"],
      ["de-AT,de;q=0.9", "de-DE"],
      ["sk", "sk-SK"],
      ["uk", "uk-UA"],
      ["uk-UA,uk;q=0.9,ru;q=0.8", "uk-UA"],
      ["vi", "vi-VN"],
      ["hi-IN,hi;q=0.9,en;q=0.8", "hi-IN"],
    ] as const) {
      expect(
        resolveWorkspaceLocale(
          sources({ pathname: "/faq", acceptLanguage }),
          undefined
        )
      ).toBe(locale);
    }
  });

  test("a reader of only unserved languages gets English", () => {
    for (const acceptLanguage of ["ru", "fr-FR,fr;q=0.9", "pl-PL,pl;q=0.9"]) {
      expect(
        resolveWorkspaceLocale(
          sources({ pathname: "/faq", acceptLanguage }),
          undefined
        )
      ).toBe("en-US");
    }
  });

  test("Slovak readers get Slovak before the Czech and English they also read", () => {
    expect(
      resolveWorkspaceLocale(
        sources({
          pathname: "/faq",
          acceptLanguage: "sk-SK,sk;q=0.9,cs;q=0.5,en;q=0.8",
        }),
        undefined
      )
    ).toBe("sk-SK");
  });
});
