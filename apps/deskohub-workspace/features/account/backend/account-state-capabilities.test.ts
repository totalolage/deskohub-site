import { testEmailAddress } from "@deskohub/test-email";
import "@/shared/testing/workspace-test-env";

import { expect, mock, test } from "bun:test";
import { Context, Effect, Layer, Option } from "effect";

// Served outside Next.js, a request never reaches Next's request APIs or the
// Next.js edge's gates, which decide through React `cache` and a nested
// runner.
const nextRequestApi = mock(() => {
  throw new Error("Next.js request API reached outside Next.js");
});
mock.module("next/headers", () => ({
  headers: nextRequestApi,
  cookies: nextRequestApi,
}));
mock.module("@/features/feature-flags/backend/release-gate.server", () => ({
  releaseGateForRequest: () => {
    throw new Error("Next.js edge release gate loaded");
  },
}));

// PostHog answers from each request's own headers, so a decision shared
// across requests would show.
const evaluations: string[] = [];
class RequestFeatureFlags extends Context.Service<RequestFeatureFlags>()(
  "@deskohub-workspace/feature-flags/WorkspaceFeatureFlagService"
) {}
const { currentRequestHeaders, withWorkspaceRequestContext } = await import(
  "@/shared/backend/workspace-request-context"
);
mock.module(
  "@/features/feature-flags/backend/workspace-feature-flag.service",
  () => ({
    WorkspaceFeatureFlagService: Object.assign(RequestFeatureFlags, {
      Default: Layer.succeed(RequestFeatureFlags, {
        isEnabled: (key: string) =>
          currentRequestHeaders.pipe(
            Effect.map((headers) => {
              evaluations.push(`${headers.get("x-test-request")} ${key}`);
              return (headers.get("x-test-flags") ?? "")
                .split(",")
                .includes(key);
            })
          ),
        evaluateFlags: () => Effect.die("not used by release gates"),
        constantValue: () => Effect.succeed(Option.none()),
      } as never),
    }),
  })
);

const { CustomerAgentConnections } = await import(
  "@/features/account/backend/auth/customer-agent-connections.service"
);
const { CustomerPasskeys } = await import(
  "@/features/account/backend/auth/customer-passkeys.service"
);
const { CustomerAccountContactService } = await import(
  "@/features/account/backend/customer-account-contact.service"
);
const { CurrentCustomerAccount } = await import(
  "@/features/account/backend/current-customer-account"
);
const { CustomerAccountResolver } = await import(
  "@/features/account/backend/customer-account-resolver.service"
);
const { CustomerAuthentication } = await import(
  "@/features/account/backend/customer-authentication.service"
);
const { CustomerAvatarService } = await import(
  "@/features/account/backend/customer-avatar.service"
);
const { CustomerProfileService } = await import(
  "@/features/account/backend/customer-profile.service"
);
const { ReferralServiceMock } = await import(
  "@/features/referrals/referral.service.mock"
);
const { ReferralSignupIntentRepository } = await import(
  "@/features/referrals/signup-intent.repository"
);
const { ReviewAccountsMock } = await import(
  "@/features/review-accounts/backend/review-accounts.repository.mock"
);
const { accountStateCapabilitiesForRun } = await import(
  "./account-state-capabilities"
);
const { loadAccountState } = await import("./account-state");

const requestName = currentRequestHeaders.pipe(
  Effect.map((headers) => headers.get("x-test-request") ?? "missing")
);

/** The account services over fakes that answer for each request's session. */
const services = {
  authentication: Layer.mock(CustomerAuthentication, {
    currentUser: requestName.pipe(
      Effect.map((name) => ({
        accountId: `account-${name}`,
        email: testEmailAddress(name),
        deletionRequested: false,
      }))
    ) as never,
  }),
  currentAccount: Layer.mock(CurrentCustomerAccount, {
    resolve: requestName.pipe(
      Effect.map((name) => ({
        kind: "linked",
        session: {
          accountId: `account-${name}`,
          email: testEmailAddress(name),
          deletionRequested: false,
        },
        reviewMarker: "absent",
        account: {
          accountId: `account-${name}`,
          dotyposCustomerId: `customer-${name}`,
        },
        autoLinked: false,
      }))
    ) as never,
  }),
  resolver: Layer.mock(CustomerAccountResolver, {}),
  profile: Layer.mock(CustomerProfileService, {
    load: () =>
      Effect.succeed({
        firstName: "Ada",
        lastName: "Lovelace",
        phone: null,
        billing: null,
      }) as never,
  }),
  avatar: Layer.mock(CustomerAvatarService, {
    lookup: () => Effect.succeed(null),
  }),
  passkeys: Layer.mock(CustomerPasskeys, { list: Effect.succeed([]) }),
  assistants: Layer.mock(CustomerAgentConnections, {
    list: Effect.succeed([]),
  }),
  reviewAccounts: ReviewAccountsMock({
    isReviewAccount: () => Effect.succeed(false),
  }),
  referrals: ReferralServiceMock({
    getAccountSummary: () =>
      Effect.succeed({
        code: "RFL12345",
        inviteeCount: 0,
        eligibleInviteeCount: 0,
        discount: "0",
        savings: [],
      }) as never,
    hasSettledReferral: () => Effect.succeed(true),
  }),
  signupIntents: Layer.mock(ReferralSignupIntentRepository, {
    find: () => Effect.succeed(undefined) as never,
  }),
  contacts: Layer.mock(CustomerAccountContactService, {}),
};

/** One request served outside Next.js, with its own capabilities. */
const serve = (request: {
  readonly name: string;
  readonly flags: string;
  readonly referralCode?: string;
}) =>
  loadAccountState.pipe(
    Effect.provide(
      accountStateCapabilitiesForRun(
        { referralCode: request.referralCode },
        services
      )
    ),
    withWorkspaceRequestContext(
      new Headers({
        "x-test-request": request.name,
        "x-test-flags": request.flags,
      })
    )
  );

test("decides each request's gates from its own context, once each, without Next.js", async () => {
  const [released, withheld] = await Effect.runPromise(
    Effect.all(
      [
        serve({
          name: "released",
          flags: "referrals,login_passkeys,account_avatars",
          referralCode: "rfl12345",
        }),
        serve({ name: "withheld", flags: "", referralCode: "RFL12345" }),
      ],
      { concurrency: "unbounded" }
    )
  );

  expect(released).toMatchObject({
    kind: "linked",
    email: testEmailAddress("released"),
    referralsEnabled: true,
    passkeys: { passkeys: [] },
    avatar: { kind: "available", avatar: null },
    // The client's code is settled, so the client forgets it.
    rememberedReferralCodeUsed: true,
  });
  expect(withheld).toMatchObject({
    kind: "linked",
    email: testEmailAddress("withheld"),
    referralsEnabled: false,
    avatar: { kind: "hidden" },
  });
  expect(withheld).not.toHaveProperty("passkeys");
  expect(withheld).not.toHaveProperty("rememberedReferralCodeUsed");
  expect(evaluations.toSorted()).toEqual([
    "released account_avatars",
    "released login_passkeys",
    "released referrals",
    "withheld account_avatars",
    "withheld login_passkeys",
    "withheld referrals",
  ]);
  expect(nextRequestApi).not.toHaveBeenCalled();
});
