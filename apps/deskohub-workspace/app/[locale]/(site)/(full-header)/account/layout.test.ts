import { afterEach, describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Context, Effect, Layer } from "effect";
import { createElement, type ReactElement, type ReactNode } from "react";
import { ReferralFeatureFlagService } from "@/features/referrals/referral-feature-flag.service";

const adaEmail = testEmailAddress("ada");

type TestSession = {
  readonly accountId: string;
  readonly email: string;
  readonly deletionRequested: boolean;
};

type AccountLayoutShellProps = {
  readonly locale: "en-US";
  readonly passkeysEnabled: boolean;
  readonly referralsEnabled: boolean;
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
const arePasskeysEnabled = mock(() => Promise.resolve(true));
let referralsEnabled = true;
const areReferralsEnabled = mock(() => Promise.resolve(referralsEnabled));
const runWithRequestLocale = mock(
  (callback: (locale: "en-US") => unknown): unknown => callback("en-US")
);

mock.module("next/server", () => ({ connection }));
mock.module("@/features/account/server/account-feature-flag.server", () => ({
  arePasskeysEnabled,
}));
mock.module("@/features/referrals/referral-feature-flag.server", () => ({
  areReferralsEnabled,
  ReferralFeatureFlagRequest: Layer.unwrap(
    Effect.promise(areReferralsEnabled).pipe(
      Effect.map(ReferralFeatureFlagService.fromDecision)
    )
  ),
}));
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

describe("account route layout", () => {
  afterEach(() => {
    connection.mockClear();
    areReferralsEnabled.mockClear();
    arePasskeysEnabled.mockClear();
    runWithRequestLocale.mockClear();
    referralsEnabled = true;
    currentUserEffect = Effect.succeed(null);
  });

  test.each([
    ["anonymous", Effect.succeed(null), false],
    [
      "signed-in",
      Effect.succeed({
        accountId: "account-1",
        email: adaEmail,
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

      expect(connection).toHaveBeenCalled();
      expect(areReferralsEnabled).toHaveBeenCalledTimes(1);
      expect(arePasskeysEnabled).toHaveBeenCalledTimes(1);
      expect(output.type).toBe(AccountLayoutShell);
      expect(output.props).toMatchObject({
        locale: "en-US",
        passkeysEnabled: true,
        referralsEnabled: true,
        signedIn: expectedSignedIn,
      });
    }
  );
});
