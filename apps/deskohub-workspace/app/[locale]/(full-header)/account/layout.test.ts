import { afterEach, describe, expect, mock, test } from "bun:test";
import { Context, Effect, Layer } from "effect";
import {
  createElement,
  type ReactElement,
  type ReactNode,
  Suspense,
} from "react";

type TestSession = {
  readonly accountId: string;
  readonly email: string;
  readonly deletionRequested: boolean;
};

type AccountLayoutShellProps = {
  readonly locale: "en-US";
  readonly signedIn: boolean;
  readonly children: ReactNode;
};

const AccountLayoutShell = (props: AccountLayoutShellProps) =>
  createElement("account-layout-shell", props, props.children);
const PageNavigationBoundary = ({
  children,
}: {
  readonly children: ReactNode;
}) => createElement("page-navigation-boundary", null, children);
const AccountLoading = ({ locale }: { readonly locale: "en-US" }) =>
  createElement("account-loading", { locale });

let currentUserEffect: Effect.Effect<TestSession | null, unknown> =
  Effect.succeed(null);

const Authentication = Context.Service<
  Authentication,
  { readonly currentUser: typeof currentUserEffect }
>()("@test/AccountLayoutAuthentication");

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
const runWithRequestLocale = mock(
  (callback: (locale: "en-US") => unknown): unknown => callback("en-US")
);

mock.module("next/server", () => ({ connection }));
mock.module(
  "@/features/account/backend/customer-authentication.service",
  () => ({ CustomerAuthentication: Authentication })
);
mock.module("@/features/account/components/account-loading", () => ({
  AccountLoading,
}));
mock.module("@/features/account/components/account-layout-shell", () => ({
  AccountLayoutShell,
}));
mock.module("@/features/i18n/server/request-locale", () => ({
  runWithRequestLocale,
}));
mock.module("@/shared/backend/workspace-effect", () => ({
  runWorkspaceEffect: () => (effect: Effect.Effect<unknown, unknown, never>) =>
    Effect.runPromise(effect),
}));
mock.module("@/shared/components/page-navigation-boundary", () => ({
  PageNavigationBoundary,
}));

const layoutSource = await Bun.file(
  new URL("./layout.tsx", import.meta.url)
).text();

describe("account route layout", () => {
  afterEach(() => {
    connection.mockClear();
    runWithRequestLocale.mockClear();
    currentUserEffect = Effect.succeed(null);
  });

  test("keeps optional authentication and dynamic work in the localized layout boundary", () => {
    expect(layoutSource).toContain(
      'import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";'
    );
    expect(layoutSource).toContain(
      'import { AccountLayoutShell } from "@/features/account/components/account-layout-shell";'
    );
    expect(layoutSource).toContain(
      'import { PageNavigationBoundary } from "@/shared/components/page-navigation-boundary";'
    );
    expect(layoutSource).toContain(
      'import { runWithRequestLocale } from "@/features/i18n/server/request-locale";'
    );
    expect(layoutSource).toContain("await connection()");
    expect(layoutSource).toMatch(
      /Effect\.flatMap\(\s*CustomerAuthentication,\s*\(authentication\) => authentication\.currentUser/
    );
    expect(layoutSource).toContain(
      "Effect.provide(CustomerAuthentication.Default)"
    );
    expect(layoutSource).toContain("Effect.result");
    expect(layoutSource).toContain(
      'runWorkspaceEffect("account.layout", { boundary: "page" })'
    );
    expect(layoutSource).toContain(
      "<Suspense fallback={<AccountLoading locale={locale} />}>"
    );
    expect(layoutSource).toContain(
      "<AccountLayoutShell locale={locale} signedIn={signedIn}>"
    );
    expect(layoutSource).toContain("<PageNavigationBoundary>");
    expect(layoutSource).not.toContain("loadCustomerAccountPage");
    expect(layoutSource).not.toContain("featureFlag");

    const shellStart = layoutSource.indexOf("<AccountLayoutShell");
    const boundaryStart = layoutSource.indexOf("<PageNavigationBoundary>");
    expect(shellStart).toBeGreaterThanOrEqual(0);
    expect(boundaryStart).toBeGreaterThan(shellStart);
    expect(
      layoutSource.slice(boundaryStart).indexOf("{children}")
    ).toBeGreaterThanOrEqual(0);
    expect(
      layoutSource.slice(boundaryStart).indexOf("{modal}")
    ).toBeGreaterThanOrEqual(0);
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
    "maps %s to shell navigation state without loading account data",
    async (_state, sessionEffect, expectedSignedIn) => {
      currentUserEffect = sessionEffect;
      const { default: AccountLayout } = await import("./layout");
      const page = createElement("page");
      const modal = createElement("modal");
      const route = AccountLayout({ children: page, modal }) as ReactElement<{
        readonly children: ReactElement<{
          readonly locale: "en-US";
          readonly children: ReactNode;
          readonly modal: ReactNode;
        }>;
        readonly fallback: ReactElement;
      }>;

      expect(route.type).toBe(Suspense);
      expect(route.props.fallback.type).toBe(AccountLoading);
      expect(connection).not.toHaveBeenCalled();

      const content = route.props.children;
      const Content = content.type as (props: {
        readonly locale: "en-US";
        readonly children: ReactNode;
        readonly modal: ReactNode;
      }) => Promise<
        ReactElement<{
          readonly locale: "en-US";
          readonly signedIn: boolean;
          readonly children: ReactElement<{ readonly children: ReactNode }>;
        }>
      >;
      const output = await Content(content.props);

      expect(connection).toHaveBeenCalledTimes(1);
      expect(output.type).toBe(AccountLayoutShell);
      expect(output.props).toMatchObject({
        locale: "en-US",
        signedIn: expectedSignedIn,
      });
      expect(output.props.children.type).toBe(PageNavigationBoundary);
      expect(output.props.children.props.children).toEqual([page, modal]);
    }
  );
});
