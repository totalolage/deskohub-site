import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Effect } from "effect";
import { Suspense } from "react";
import { getLocalizedPagePath, locales } from "@/features/i18n/routing";

const connection = mock(() => Promise.resolve());

mock.module("next/server", () => ({ connection }));
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
mock.module("@/features/i18n", () => ({
  getLocalizedPagePath,
  isLocale: (value: string) => value === "en-US",
  locales,
  m: {},
}));
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
    connection.mockClear();
  });

  test("keeps request reads inside the callback suspense boundary", async () => {
    const { default: CustomerAuthCallbackPage } = await import("./page");

    const output = await CustomerAuthCallbackPage({
      searchParams: Promise.resolve({}),
    });

    expect(output.type).toBe(Suspense);
    expect(connection).not.toHaveBeenCalled();
  });
});
