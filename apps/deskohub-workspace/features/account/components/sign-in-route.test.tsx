import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { unsafeReturnTargets } from "@/shared/testing/unsafe-return-targets.test-utils";

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
    readonly noLongerWaiting: boolean;
    readonly passkeysEnabled: boolean;
    readonly returnTo?: string;
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
        noLongerWaiting: false,
        passkeysEnabled,
        returnTo: undefined,
      });
    }
  );

  test("passes only a same-origin return target on, with its query", async () => {
    const returnTo = "/en-US/reservation?date=2026-10-20&contact=a.b";

    expect((await render({ returnTo })).props.returnTo).toBe(returnTo);
    expect(
      (await render({ returnTo: [returnTo, "/en-US/account"] })).props.returnTo
    ).toBe(returnTo);
    for (const unsafe of unsafeReturnTargets) {
      expect(
        (await render({ returnTo: unsafe })).props.returnTo
      ).toBeUndefined();
    }
  });

  test("shows the no-longer-waiting notice only for its own notice value", async () => {
    expect(
      (await render({ notice: "no-longer-waiting" })).props.noLongerWaiting
    ).toBe(true);
    expect(
      (await render({ notice: ["no-longer-waiting", "other"] })).props
        .noLongerWaiting
    ).toBe(true);
    for (const notice of [undefined, "", "other", "NO-LONGER-WAITING"]) {
      expect((await render({ notice })).props.noLongerWaiting).toBe(false);
    }
  });
});
