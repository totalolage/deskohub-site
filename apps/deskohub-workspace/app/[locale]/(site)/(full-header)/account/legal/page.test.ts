import { afterEach, describe, expect, mock, test } from "bun:test";
import { createElement, type ReactElement, Suspense } from "react";

type TestMarketingPreferences = {
  readonly context?: string;
  readonly source?: "account";
  readonly status: "active" | "unavailable";
};

type PublicAccountLegalProps = {
  readonly locale: "en-US";
  readonly marketingPreferences: TestMarketingPreferences;
};

const AccountContentLoading = mock(() => null);
const PublicAccountLegal = (props: PublicAccountLegalProps) =>
  createElement("public-account-legal", props);
const marketingPreferences = {
  value: { status: "unavailable" } as TestMarketingPreferences,
};
const callOrder: string[] = [];

const connection = mock(() => {
  callOrder.push("connection");
  return Promise.resolve();
});
const getMarketingPreferences = mock((_locale: "en-US") => {
  callOrder.push("marketing-preferences");
  return Promise.resolve(marketingPreferences.value);
});
const runWithRequestLocale = mock(
  (callback: (locale: "en-US") => unknown): unknown => callback("en-US")
);

mock.module("next/server", () => ({ connection }));
mock.module("@/features/account/components/account-loading", () => ({
  AccountContentLoading,
}));
mock.module("@/features/account/components/public-account-legal", () => ({
  PublicAccountLegal,
}));
mock.module("@/features/legal/marketing-preferences.server", () => ({
  getMarketingPreferences,
}));
mock.module("@/features/i18n/server/request-locale", () => ({
  runWithRequestLocale,
}));

describe("public account legal route boundary", () => {
  afterEach(() => {
    AccountContentLoading.mockClear();
    connection.mockClear();
    getMarketingPreferences.mockClear();
    runWithRequestLocale.mockClear();
    callOrder.length = 0;
    marketingPreferences.value = { status: "unavailable" };
  });

  test("checks request connection before preference data", async () => {
    const { default: PublicAccountLegalPage } = await import("./page");
    const route = PublicAccountLegalPage() as ReactElement<{
      readonly children: ReactElement<{ readonly locale: "en-US" }>;
      readonly fallback: ReactElement;
    }>;

    expect(route.type).toBe(Suspense);
    expect(route.props.fallback).toBeTruthy();
    expect(callOrder).toEqual([]);

    const content = route.props.children;
    const Content = content.type as (props: {
      readonly locale: "en-US";
    }) => Promise<ReactElement<PublicAccountLegalProps>>;
    await Content(content.props);

    expect(callOrder).toEqual(["connection", "marketing-preferences"]);
    expect(connection).toHaveBeenCalledTimes(1);
    expect(getMarketingPreferences).toHaveBeenCalledWith("en-US");
  });
});
