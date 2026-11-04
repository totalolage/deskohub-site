import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Result } from "effect";

const values = new Map<string, string>();
let writable = true;
const set = mock(
  (name: string, value: string, options: { maxAge?: number }) => {
    if (!writable) throw new Error("Cookie write outside an action or route");
    if (options.maxAge === 0) values.delete(name);
    else values.set(name, value);
  }
);
mock.module("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = values.get(name);
      return value === undefined ? undefined : { value };
    },
    set,
  }),
}));
const { MarketingManagementCookies, marketingManagementCookieNames } =
  await import("./marketing-management-cookies.service");
const run = <A, E>(
  use: (cookies: MarketingManagementCookies["Service"]) => Effect.Effect<A, E>
) =>
  Effect.runPromise(
    Effect.flatMap(MarketingManagementCookies, use).pipe(
      Effect.provide(MarketingManagementCookies.Default)
    )
  );
const secure = { httpOnly: true, path: "/", sameSite: "lax", secure: true };

beforeEach(() => {
  values.clear();
  set.mockClear();
  writable = true;
});

describe("marketing request cookie adapter", () => {
  test("switches from session to a ten-minute host-only pending cookie", async () => {
    values.set(marketingManagementCookieNames.session, "old-session");
    await run((cookies) => cookies.setPending("pending-token"));
    expect(await run((cookies) => cookies.read)).toEqual({
      pending: "pending-token",
      session: undefined,
    });
    expect(set).toHaveBeenLastCalledWith(
      marketingManagementCookieNames.pending,
      "pending-token",
      { ...secure, maxAge: 600 }
    );
    expect(set.mock.calls[0]?.[2]).toEqual({ ...secure, maxAge: 0 });
    expect(marketingManagementCookieNames.pending).toStartWith("__Host-");
    expect(marketingManagementCookieNames.session).toStartWith("__Host-");
  });

  test("installs the exact session expiry, removes pending and clears both cookies", async () => {
    const expiresAt = new Date("2030-01-02T03:04:05.678Z");
    await run((cookies) => cookies.setPending("pending-token"));
    await run((cookies) =>
      cookies.setSession({ token: "session-token", expiresAt })
    );
    expect(await run((cookies) => cookies.read)).toEqual({
      pending: undefined,
      session: "session-token",
    });
    expect(set).toHaveBeenLastCalledWith(
      marketingManagementCookieNames.session,
      "session-token",
      { ...secure, expires: expiresAt }
    );
    await run((cookies) => cookies.clear);
    expect(await run((cookies) => cookies.read)).toEqual({
      pending: undefined,
      session: undefined,
    });
  });

  test("reads while rendering but reduces a forbidden write to a safe typed failure", async () => {
    writable = false;
    expect(await run((cookies) => cookies.read)).toEqual({
      pending: undefined,
      session: undefined,
    });
    const result = await run((cookies) =>
      cookies.setPending("pending-token").pipe(Effect.result)
    );
    expect(Result.isFailure(result) && result.failure._tag).toBe(
      "MarketingManagementCookiesUnavailable"
    );
    expect(values.size).toBe(0);
  });
});
