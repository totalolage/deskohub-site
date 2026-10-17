import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";

const events: string[] = [];
const arePasskeysEnabled = mock(() => Promise.resolve(false));
const connection = mock(() => Promise.resolve());

mock.module("next/server", () => ({ connection }));
mock.module("@/features/account/server/account-feature-flag.server", () => ({
  arePasskeysEnabled,
}));

const { SignInRouteCard } = await import("./sign-in-route");

const render = async (query: Record<string, string | string[] | undefined>) =>
  (await SignInRouteCard({
    locale: "en-US",
    searchParams: Promise.resolve(query),
  })) as ReactElement<{
    readonly locale: string;
    readonly passkeysEnabled: boolean;
    readonly returnPath?: string;
  }>;

describe("sign-in route card", () => {
  beforeEach(() => {
    events.length = 0;
    arePasskeysEnabled.mockReset();
    arePasskeysEnabled.mockImplementation(async () => {
      events.push("passkeys");
      return false;
    });
    connection.mockReset();
    connection.mockImplementation(async () => {
      events.push("connection");
    });
  });

  test("reads the passkey flag after establishing the request-bound render", async () => {
    await render({});

    expect(events).toEqual(["connection", "passkeys"]);
  });

  test.each([true, false])(
    "passes the passkey flag (%p) to the sign-in card",
    async (passkeysEnabled) => {
      arePasskeysEnabled.mockImplementation(async () => passkeysEnabled);

      expect((await render({})).props).toEqual({
        locale: "en-US",
        passkeysEnabled,
        returnPath: undefined,
      });
    }
  );

  test("passes a valid return path on with its query", async () => {
    const returnPath = "/en-US/reservation?date=2026-10-20&contact=a.b";

    expect((await render({ returnTo: returnPath })).props.returnPath).toBe(
      returnPath
    );
    expect(
      (await render({ returnTo: [returnPath, "/en-US/account"] })).props
        .returnPath
    ).toBe(returnPath);
  });

  test.each([
    "https://evil.example/en-US/account",
    "//evil.example/en-US/account",
    "/en-US/auth/verify",
  ])(
    "drops the return path %s, so the sign-in returns to the account",
    async (returnTo) => {
      expect((await render({ returnTo })).props.returnPath).toBeUndefined();
    }
  );
});
