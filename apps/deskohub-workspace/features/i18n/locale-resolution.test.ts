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
        sources({ cookie: "sk-SK", acceptLanguage: "de" }),
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

  test("Slovak readers get Czech", () => {
    expect(
      resolveWorkspaceLocale(
        sources({
          pathname: "/faq",
          acceptLanguage: "sk-SK,sk;q=0.9,en;q=0.8",
        }),
        undefined
      )
    ).toBe("cs-CZ");
  });
});
