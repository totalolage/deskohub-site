import { afterEach, describe, expect, mock, test } from "bun:test";
import { Context, Effect, Layer } from "effect";
import { type ReactElement, Suspense } from "react";

type TestSession = {
  readonly accountId: string;
  readonly email: string;
  readonly deletionRequested: boolean;
};

type TestMarketingPreferences = {
  readonly context?: string;
  readonly source?: "account";
  readonly status: "active" | "unavailable";
};

type PublicAccountLegalProps = {
  readonly accountsEnabled: boolean;
  readonly locale: "en-US";
  readonly marketingPreferences: TestMarketingPreferences;
  readonly signedIn: boolean;
};

let currentUserEffect: Effect.Effect<TestSession | null, unknown> =
  Effect.succeed(null);
let currentUserReads = 0;
let accountFlagEnabled = true;
let marketingPreferences: TestMarketingPreferences = {
  status: "unavailable",
};
const callOrder: string[] = [];

const Authentication = Context.Service<
  Authentication,
  { readonly currentUser: typeof currentUserEffect }
>()("@test/PublicAccountAuthentication");

const AuthenticationLayer = Layer.effect(
  Authentication,
  Effect.succeed({
    get currentUser() {
      return currentUserEffect;
    },
  })
);
Object.assign(Authentication, { Default: AuthenticationLayer });

const connection = mock(() => {
  callOrder.push("connection");
  return Promise.resolve();
});
const areAccountsEnabled = mock(() => {
  callOrder.push("flag");
  return Promise.resolve(accountFlagEnabled);
});
const getMarketingPreferences = mock((_locale: "en-US") => {
  callOrder.push("marketing-preferences");
  return Promise.resolve(marketingPreferences);
});

mock.module("next/server", () => ({ connection }));
mock.module("@/features/account/server/account-feature-flag.server", () => ({
  areAccountsEnabled,
}));
mock.module(
  "@/features/account/backend/customer-authentication.service",
  () => ({ CustomerAuthentication: Authentication })
);
mock.module("@/features/account/components/public-account-legal", () => ({
  PublicAccountLegal: (_props: PublicAccountLegalProps) => null,
}));
mock.module("@/features/legal/marketing-preferences.server", () => ({
  getMarketingPreferences,
}));
mock.module("@/features/i18n/server/request-locale", () => ({
  runWithRequestLocale: (callback: (locale: "en-US") => unknown): unknown =>
    callback("en-US"),
}));
mock.module("@/shared/backend/workspace-effect", () => ({
  runWorkspaceEffect: () => (effect: Effect.Effect<unknown, unknown, never>) =>
    Effect.runPromise(effect),
}));

const pageSource = await Bun.file(
  new URL("./page.tsx", import.meta.url)
).text();

describe("public account legal route boundary", () => {
  afterEach(() => {
    connection.mockClear();
    areAccountsEnabled.mockClear();
    getMarketingPreferences.mockClear();
    callOrder.length = 0;
    currentUserReads = 0;
    accountFlagEnabled = true;
    marketingPreferences = { status: "unavailable" };
    currentUserEffect = Effect.succeed(null);
  });

  test("reads only the authoritative session before rendering the legal screen", () => {
    expect(pageSource).toContain('import { Suspense } from "react";');
    expect(pageSource).toContain(
      'import { AccountLoading } from "@/features/account/components/account-loading";'
    );
    expect(pageSource).toContain('import { connection } from "next/server";');
    expect(pageSource).toContain(
      'import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";'
    );
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
      "export default function PublicAccountLegalPage()"
    );
    expect(pageSource).not.toContain(
      "export default async function PublicAccountLegalPage()"
    );
    expect(pageSource).toContain(
      "<Suspense fallback={<AccountLoading locale={locale} />}>"
    );
    expect(pageSource).toContain(
      "<PublicAccountLegalPageContent locale={locale} />"
    );
    expect(pageSource).toMatch(
      /async function PublicAccountLegalPageContent[\s\S]*await connection\(\)[\s\S]*Effect\.flatMap/
    );
    expect(pageSource).toMatch(
      /Effect\.flatMap\(\s*CustomerAuthentication,\s*\(authentication\) => authentication\.currentUser/
    );
    expect(pageSource).toContain(
      "Effect.provide(CustomerAuthentication.Default)"
    );
    expect(pageSource).toContain("<PublicAccountLegal");
    expect(pageSource).toContain("accountsEnabled={accountsEnabled}");
    expect(pageSource).toContain("marketingPreferences={marketingPreferences}");
    expect(pageSource).toMatch(
      /await connection\(\)[\s\S]*const accountsEnabled = await areAccountsEnabled\(\)/
    );

    for (const forbiddenReference of [
      "loadCustomerAccountPage",
      "resolveCurrentCustomerAccount",
      "CustomerProfileService",
      "CustomerReservationHistoryService",
      "Dotypos",
      "profile",
      "history",
    ]) {
      expect(pageSource).not.toContain(forbiddenReference);
    }

    const routeSource = pageSource.slice(pageSource.indexOf("export default"));
    const boundaryStart = routeSource.indexOf("<Suspense");
    expect(boundaryStart).toBeGreaterThanOrEqual(0);
    expect(routeSource.slice(0, boundaryStart)).not.toContain(
      "await connection()"
    );
  });

  test.each([
    ["anonymous", Effect.succeed(null), false],
    [
      "signed-in",
      Effect.succeed({
        accountId: "account-1",
        email: "ada@example.test",
        deletionRequested: false,
      }),
      true,
    ],
    ["auth failure", Effect.fail(new Error("synthetic auth failure")), false],
  ] as const)(
    "executes the localized suspense route for %s without private account services",
    async (_state, sessionEffect, expectedSignedIn) => {
      currentUserEffect = sessionEffect;
      const { default: PublicAccountLegalPage } = await import("./page");
      const route = PublicAccountLegalPage() as ReactElement<{
        readonly children: ReactElement<{ readonly locale: "en-US" }>;
        readonly fallback: ReactElement;
      }>;

      expect(route.type).toBe(Suspense);
      expect(route.props.fallback).toBeTruthy();
      expect(connection).not.toHaveBeenCalled();

      const content = route.props.children;
      const Content = content.type as (props: {
        readonly locale: "en-US";
      }) => Promise<ReactElement<PublicAccountLegalProps>>;
      const output = await Content(content.props);

      expect(connection).toHaveBeenCalledTimes(1);
      expect(areAccountsEnabled).toHaveBeenCalledTimes(1);
      expect(output.props).toEqual({
        accountsEnabled: true,
        locale: "en-US",
        marketingPreferences: { status: "unavailable" },
        signedIn: expectedSignedIn,
      });
    }
  );

  test("keeps a signed-in session authoritative when the account flag is off", async () => {
    accountFlagEnabled = false;
    marketingPreferences = {
      context: "synthetic-account-context",
      source: "account",
      status: "active",
    };
    currentUserEffect = Effect.sync(() => {
      currentUserReads += 1;
      return {
        accountId: "account-1",
        email: "ada@example.test",
        deletionRequested: false,
      };
    });

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

    expect(currentUserReads).toBe(1);
    expect(areAccountsEnabled).toHaveBeenCalledTimes(1);
    expect(getMarketingPreferences).toHaveBeenCalledWith("en-US");
    expect(callOrder.indexOf("connection")).toBeLessThan(
      callOrder.indexOf("flag")
    );
    expect(output.props).toEqual({
      accountsEnabled: false,
      locale: "en-US",
      marketingPreferences,
      signedIn: true,
    });
  });
});
