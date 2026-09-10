import { afterEach, describe, expect, mock, test } from "bun:test";
import { Context, Effect, Layer } from "effect";
import { type ReactElement, Suspense } from "react";

type TestSession = {
  readonly accountId: string;
  readonly email: string;
  readonly deletionRequested: boolean;
};

type PublicAccountLegalProps = {
  readonly locale: "en-US";
  readonly signedIn: boolean;
};

let currentUserEffect: Effect.Effect<TestSession | null, unknown> =
  Effect.succeed(null);

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

const connection = mock(() => Promise.resolve());

mock.module("next/server", () => ({ connection }));
mock.module(
  "@/features/account/backend/customer-authentication.service",
  () => ({ CustomerAuthentication: Authentication })
);
mock.module("@/features/account/components/public-account-legal", () => ({
  PublicAccountLegal: (_props: PublicAccountLegalProps) => null,
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
    expect(pageSource).toContain(
      "<PublicAccountLegal locale={locale} signedIn={signedIn} />"
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
      expect(output.props).toEqual({
        locale: "en-US",
        signedIn: expectedSignedIn,
      });
    }
  );
});
