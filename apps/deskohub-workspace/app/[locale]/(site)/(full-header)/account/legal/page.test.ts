import { afterEach, describe, expect, mock, test } from "bun:test";
import { createElement, type ReactElement, Suspense } from "react";

type TestMarketingPreferences = {
  readonly context?: string;
  readonly source?: "account";
  readonly status: "active" | "unavailable";
};

type TestAnalyticsPreference = {
  readonly status: "unavailable";
};

type PublicAccountLegalProps = {
  readonly accountDataExportAvailable: boolean;
  readonly analyticsPreference: TestAnalyticsPreference;
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
const getAnalyticsPreference = mock((_locale: "en-US") => {
  callOrder.push("analytics-preference");
  return Promise.resolve<TestAnalyticsPreference>({ status: "unavailable" });
});
const accountDataExportAvailability = { value: false };
const getAccountDataExportAvailability = mock((_locale: "en-US") => {
  callOrder.push("account-data-export-availability");
  return Promise.resolve(accountDataExportAvailability.value);
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
mock.module("@/features/legal/analytics-preference.server", () => ({
  getAnalyticsPreference,
}));
mock.module(
  "@/features/account/account-data-export-availability.server",
  () => ({
    getAccountDataExportAvailability,
  })
);
mock.module("@/features/i18n/server/request-locale", () => ({
  runWithRequestLocale,
}));

describe("public account legal route boundary", () => {
  afterEach(() => {
    AccountContentLoading.mockClear();
    connection.mockClear();
    getMarketingPreferences.mockClear();
    getAnalyticsPreference.mockClear();
    getAccountDataExportAvailability.mockClear();
    runWithRequestLocale.mockClear();
    callOrder.length = 0;
    marketingPreferences.value = { status: "unavailable" };
    accountDataExportAvailability.value = false;
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

    expect(callOrder).toEqual([
      "connection",
      "marketing-preferences",
      "analytics-preference",
      "account-data-export-availability",
    ]);
    expect(connection).toHaveBeenCalledTimes(1);
    expect(getMarketingPreferences).toHaveBeenCalledWith("en-US");
    expect(getAnalyticsPreference).toHaveBeenCalledWith("en-US");
    expect(getAccountDataExportAvailability).toHaveBeenCalledWith("en-US");
  });

  test.each([true, false])(
    "passes the export availability %p to the legal screen",
    async (available) => {
      accountDataExportAvailability.value = available;
      const { default: PublicAccountLegalPage } = await import("./page");
      const route = PublicAccountLegalPage() as ReactElement<{
        readonly children: ReactElement<{ readonly locale: "en-US" }>;
      }>;
      const content = route.props.children;
      const Content = content.type as (props: {
        readonly locale: "en-US";
      }) => Promise<ReactElement<PublicAccountLegalProps>>;

      const rendered = await Content(content.props);

      expect(rendered.props.accountDataExportAvailable).toBe(available);
    }
  );
});
