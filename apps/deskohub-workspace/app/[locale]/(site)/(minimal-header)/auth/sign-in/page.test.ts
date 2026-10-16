import { beforeEach, describe, expect, mock, test } from "bun:test";

const events: string[] = [];
const notFound = mock(() => {
  throw new Error("NEXT_NOT_FOUND");
});
const areAccountsEnabled = mock(() => Promise.resolve(true));
const connection = mock(() => Promise.resolve());

mock.module("next/navigation", () => ({ notFound }));
mock.module("next/server", () => ({ connection }));
mock.module("@/features/account/server/account-feature-flag.server", () => ({
  areAccountsEnabled,
}));
mock.module("@/features/account/components/sign-in-card", () => ({
  SignInCard: () => null,
}));
mock.module("@/features/i18n", () => ({ m: {} }));
mock.module("@/features/i18n/server/request-locale", () => ({
  runWithRequestLocale: (callback: (locale: "en-US") => unknown) =>
    callback("en-US"),
}));

describe("customer sign-in route boundary", () => {
  beforeEach(() => {
    events.length = 0;
    notFound.mockReset();
    notFound.mockImplementation(() => {
      throw new Error("NEXT_NOT_FOUND");
    });
    areAccountsEnabled.mockReset();
    areAccountsEnabled.mockImplementation(async () => {
      events.push("gate");
      return true;
    });
    connection.mockReset();
    connection.mockImplementation(async () => {
      events.push("connection");
    });
  });

  test("checks the account gate after establishing the request-bound page", async () => {
    const { default: CustomerSignInPage } = await import("./page");

    const output = await CustomerSignInPage();

    expect(output).toMatchObject({ type: "main" });
    expect(events).toEqual(["connection", "gate"]);
  });

  test("returns not found after establishing a request when disabled", async () => {
    areAccountsEnabled.mockImplementation(async () => {
      events.push("gate");
      return false;
    });
    const { default: CustomerSignInPage } = await import("./page");

    await expect(CustomerSignInPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(events).toEqual(["connection", "gate"]);
    expect(connection).toHaveBeenCalledTimes(1);
  });
});
