import { afterEach, describe, expect, mock, test } from "bun:test";
import { createElement, type ReactElement, Suspense } from "react";

type TestMarketingPreferences = {
  readonly context?: string;
  readonly source?: "account";
  readonly status: "active" | "unavailable";
};

type PublicAccountLegalProps = {
  readonly accountsEnabled: boolean;
  readonly locale: "en-US";
  readonly marketingPreferences: TestMarketingPreferences;
};

const AccountContentLoading = mock(() => null);
const PublicAccountLegal = (props: PublicAccountLegalProps) =>
  createElement("public-account-legal", props);
const accountFlagEnabled = { value: true };
const marketingPreferences = {
  value: { status: "unavailable" } as TestMarketingPreferences,
};
const callOrder: string[] = [];

const connection = mock(() => {
  callOrder.push("connection");
  return Promise.resolve();
});
const areAccountsEnabled = mock(() => {
  callOrder.push("flag");
  return Promise.resolve(accountFlagEnabled.value);
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
mock.module("@/features/account/server/account-feature-flag.server", () => ({
  areAccountsEnabled,
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

const pageSource = await Bun.file(
  new URL("./page.tsx", import.meta.url)
).text();

describe("public account legal route boundary", () => {
  afterEach(() => {
    AccountContentLoading.mockClear();
    connection.mockClear();
    areAccountsEnabled.mockClear();
    getMarketingPreferences.mockClear();
    runWithRequestLocale.mockClear();
    callOrder.length = 0;
    accountFlagEnabled.value = true;
    marketingPreferences.value = { status: "unavailable" };
  });

  test("keeps the localized public content behind its request-boundary fallback", () => {
    expect(pageSource).toContain('import { Suspense } from "react";');
    expect(pageSource).toContain(
      'import { AccountContentLoading } from "@/features/account/components/account-loading";'
    );
    expect(pageSource).toContain('import { connection } from "next/server";');
    expect(pageSource).toContain(
      'import { areAccountsEnabled } from "@/features/account/server/account-feature-flag.server";'
    );
    expect(pageSource).toContain(
      'import { getMarketingPreferences } from "@/features/legal/marketing-preferences.server";'
    );
    expect(pageSource).toContain(
      'import { runWithRequestLocale } from "@/features/i18n/server/request-locale";'
    );
    expect(pageSource).toContain(
      "export async function generateMetadata(): Promise<Metadata>"
    );
    expect(pageSource).toContain(
      "export default function PublicAccountLegalPage()"
    );
    expect(pageSource).toContain(
      "<Suspense fallback={<AccountContentLoading locale={locale} />}>"
    );
    expect(pageSource).toContain(
      "<PublicAccountLegalPageContent locale={locale} />"
    );
    expect(pageSource).toMatch(
      /async function PublicAccountLegalPageContent[\s\S]*await connection\(\)[\s\S]*const accountsEnabled = await areAccountsEnabled\(\)[\s\S]*const marketingPreferences = await getMarketingPreferences\(locale\)/
    );
    expect(pageSource).toContain("accountsEnabled={accountsEnabled}");
    expect(pageSource).toContain("marketingPreferences={marketingPreferences}");
    expect(pageSource).toContain("robots: { index: false, follow: false }");

    for (const forbiddenReference of [
      "CustomerAuthentication",
      "Effect",
      "Result",
      "runWorkspaceEffect",
      "loadCustomerAccountPage",
      "resolveCurrentCustomerAccount",
      "CustomerProfileService",
      "CustomerReservationHistoryService",
      "Dotypos",
      "profile",
      "history",
      "AccountShell",
      "signedIn",
    ]) {
      expect(pageSource).not.toContain(forbiddenReference);
    }

    const routeSource = pageSource.slice(pageSource.indexOf("export default"));
    const boundaryStart = routeSource.indexOf("<Suspense");
    expect(boundaryStart).toBeGreaterThanOrEqual(0);
    expect(routeSource.slice(0, boundaryStart)).not.toContain(
      "await connection()"
    );
    expect(routeSource.slice(0, boundaryStart)).not.toContain(
      "getMarketingPreferences"
    );
  });

  test("checks request connection before the account flag and preference data", async () => {
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
    const output = await Content(content.props);

    expect(callOrder).toEqual(["connection", "flag", "marketing-preferences"]);
    expect(connection).toHaveBeenCalledTimes(1);
    expect(areAccountsEnabled).toHaveBeenCalledTimes(1);
    expect(getMarketingPreferences).toHaveBeenCalledWith("en-US");
    expect(output).toMatchObject({
      type: PublicAccountLegal,
      props: {
        accountsEnabled: true,
        locale: "en-US",
        marketingPreferences: { status: "unavailable" },
      },
    });
  });

  test("keeps public legal content available when accounts are disabled and forwards preferences", async () => {
    accountFlagEnabled.value = false;
    marketingPreferences.value = {
      context: "synthetic-account-context",
      source: "account",
      status: "active",
    };

    const { default: PublicAccountLegalPage } = await import("./page");
    const route = PublicAccountLegalPage() as ReactElement<{
      readonly children: ReactElement<{ readonly locale: "en-US" }>;
      readonly fallback: ReactElement;
    }>;
    const content = route.props.children;
    const Content = content.type as (props: {
      readonly locale: "en-US";
    }) => Promise<ReactElement<PublicAccountLegalProps>>;
    const output = await Content(content.props);

    expect(callOrder).toEqual(["connection", "flag", "marketing-preferences"]);
    expect(output).toMatchObject({
      type: PublicAccountLegal,
      props: {
        accountsEnabled: false,
        locale: "en-US",
        marketingPreferences: {
          context: "synthetic-account-context",
          source: "account",
          status: "active",
        },
      },
    });
  });
});
