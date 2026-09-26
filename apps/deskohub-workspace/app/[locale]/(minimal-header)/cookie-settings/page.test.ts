import { describe, expect, mock, test } from "bun:test";

const redirect = mock(() => undefined);

mock.module("next/navigation", () => ({ redirect }));
mock.module("@/features/i18n/server/request-locale", () => ({
  runWithRequestLocale: (callback: (locale: "en-US") => unknown) =>
    callback("en-US"),
}));

describe("cookie settings route boundary", () => {
  test("redirects every locale to the public account legal route", async () => {
    const { default: CookieSettingsRedirect } = await import("./page");

    await CookieSettingsRedirect();

    expect(redirect).toHaveBeenCalledWith("/en-US/account/legal");
  });
});
