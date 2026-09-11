import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Effect } from "effect";
import { Suspense } from "react";

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
mock.module(
  "@/features/account/backend/customer-authentication.service",
  () => ({
    CustomerAuthentication: {},
  })
);
mock.module("@/features/account/components/auth-callback-loading", () => ({
  AuthCallbackLoading: () => null,
}));
mock.module("@/features/account/components/auth-callback-redirect", () => ({
  AuthCallbackRedirect: () => null,
}));
mock.module("@/features/i18n", () => ({ m: {} }));
mock.module("@/features/i18n/server/request-locale", () => ({
  runWithRequestLocale: (callback: (locale: "en-US") => unknown) =>
    callback("en-US"),
}));
mock.module("@/shared/backend/workspace-effect", () => ({
  runWorkspaceEffect:
    () =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect,
}));
mock.module("@/shared/components/ui/button", () => ({
  Button: () => null,
}));
mock.module("@/shared/components/ui/card", () => ({
  Card: () => null,
  CardContent: () => null,
}));

describe("customer auth callback route boundary", () => {
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

  test("keeps the account gate inside the callback suspense boundary", async () => {
    const { default: CustomerAuthCallbackPage } = await import("./page");

    const output = CustomerAuthCallbackPage();

    expect(output.type).toBe(Suspense);
    expect(events).toEqual([]);
    expect(areAccountsEnabled).not.toHaveBeenCalled();
    expect(connection).not.toHaveBeenCalled();
  });

  test("checks the gate after connection and before the callback session when disabled", async () => {
    areAccountsEnabled.mockImplementation(async () => {
      events.push("gate");
      return false;
    });
    const { default: CustomerAuthCallbackPage } = await import("./page");
    const output = CustomerAuthCallbackPage();
    const content = output.props.children;
    const Content = content.type as (props: {
      readonly locale: "en-US";
    }) => Promise<unknown>;

    await expect(Content(content.props)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(events).toEqual(["connection", "gate"]);
  });
});
