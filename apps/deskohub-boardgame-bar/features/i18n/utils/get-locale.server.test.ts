import { describe, expect, mock, test } from "bun:test";

let requestHeaders = new Headers();

mock.module("next/headers", () => ({
  headers: mock(async () => requestHeaders),
}));

describe("getLocaleFromServer", () => {
  test("reads the locale cookie when the request has no referer", async () => {
    const { getLocaleFromServer } = await import("./get-locale.server");
    requestHeaders = new Headers({ cookie: "PARAGLIDE_LOCALE=en-US" });

    expect(await getLocaleFromServer()).toBe("en-US");
  });

  test("reads the locale cookie when the request has a referer", async () => {
    const { getLocaleFromServer } = await import("./get-locale.server");
    requestHeaders = new Headers({
      cookie: "PARAGLIDE_LOCALE=en-US",
      referer: "https://deskohub.cz/cs-CZ/reservation",
    });

    expect(await getLocaleFromServer()).toBe("en-US");
  });
});
