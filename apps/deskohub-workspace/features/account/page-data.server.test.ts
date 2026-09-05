import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Context, Data, Effect, Layer } from "effect";
import type { CustomerAccountId } from "@/features/account/customer-account";

let currentUserEffect: Effect.Effect<
  {
    readonly accountId: CustomerAccountId;
    readonly email: string;
    readonly deletionRequested: boolean;
  } | null,
  unknown
>;

const Authentication = Context.Service<
  Authentication,
  {
    readonly currentUser: typeof currentUserEffect;
  }
>()("@test/AccountAuthentication");

const AuthenticationLayer = Layer.effect(
  Authentication,
  Effect.succeed({
    get currentUser() {
      return currentUserEffect;
    },
  })
);
Object.assign(Authentication, {
  Default: AuthenticationLayer,
  Live: AuthenticationLayer,
});

const accountId = "auth-account-1" as CustomerAccountId;
const activeSession = {
  accountId,
  email: "ada@example.test",
  deletionRequested: false,
};

let resolveEffect: Effect.Effect<
  { readonly accountId: CustomerAccountId; readonly dotyposCustomerId: string },
  { readonly reason: string; readonly linkReason?: string }
>;

const Resolver = Context.Service<
  Resolver,
  { readonly resolve: () => typeof resolveEffect }
>()("@test/AccountResolver");

const ResolverLayer = Layer.succeed(Resolver, {
  resolve: () => resolveEffect,
});
Object.assign(Resolver, { Live: ResolverLayer });

const resolverOutcome = (
  outcome:
    | { readonly kind: "success"; readonly customerId: string }
    | {
        readonly kind: "failure";
        readonly reason: string;
        readonly linkReason?: string;
      }
) =>
  outcome.kind === "success"
    ? Effect.succeed({ accountId, dotyposCustomerId: outcome.customerId })
    : Effect.fail({ reason: outcome.reason, linkReason: outcome.linkReason });

const Profile = Context.Service<
  Profile,
  {
    readonly load: () => Effect.Effect<
      {
        readonly firstName: string;
        readonly lastName: string | null;
        readonly phone: string | null;
        readonly billing: null;
      },
      unknown
    >;
  }
>()("@test/AccountProfile");

const profileLoadEffect = Effect.succeed({
  firstName: "Ada",
  lastName: "Lovelace",
  phone: null,
  billing: null,
});

const ProfileLayer = Layer.succeed(Profile, {
  load: () => profileLoadEffect,
});
Object.assign(Profile, { Live: ProfileLayer });

let historyEffect: Effect.Effect<
  | {
      readonly kind: "available";
      readonly groups: {
        current: unknown[];
        past: unknown[];
        unavailable: unknown[];
      };
    }
  | { readonly kind: "unavailable"; readonly reason: string },
  unknown
>;

const History = Context.Service<
  History,
  { readonly load: () => typeof historyEffect }
>()("@test/AccountReservationHistory");

const HistoryLayer = Layer.succeed(History, {
  load: () => historyEffect,
});
Object.assign(History, { Live: HistoryLayer });

class RedirectError extends Data.TaggedError("RedirectError")<{
  readonly to: string;
}> {}

mock.module(
  "@/features/account/backend/customer-authentication.service",
  () => ({
    CustomerAuthentication: Authentication,
  })
);
mock.module(
  "@/features/account/backend/customer-account-resolver.service",
  () => ({
    resolveCurrentCustomerAccount: Effect.suspend(() => resolveEffect),
    CustomerAccountResolver: Resolver,
  })
);
mock.module("@/features/account/backend/customer-profile.service", () => ({
  CustomerProfileService: Profile,
}));
mock.module(
  "@/features/account/backend/customer-reservation-history.service",
  () => ({
    CustomerReservationHistoryService: History,
  })
);
mock.module("next/navigation", () => ({
  redirect: (to: string) => {
    throw new RedirectError({ to });
  },
  unstable_rethrow: (cause: unknown) => {
    throw cause;
  },
}));
mock.module("@/shared/backend/workspace-effect", () => ({
  runWorkspaceEffect:
    (_operation: string, _options: { readonly boundary: string }) =>
    (effect: Effect.Effect<unknown, unknown, never>) =>
      Effect.runPromise(effect),
}));

describe("loadCustomerAccountPage", () => {
  beforeEach(() => {
    currentUserEffect = Effect.succeed(activeSession);
    resolveEffect = resolverOutcome({ kind: "success", customerId: "60111" });
    historyEffect = Effect.succeed({
      kind: "available",
      groups: { current: [], past: [], unavailable: [] },
    });
  });

  const loadPageState = async () => {
    const { loadCustomerAccountPage } = await import("./page-data.server");
    return loadCustomerAccountPage("en-US");
  };

  test("redirects anonymous visitors to the localized sign-in page", async () => {
    currentUserEffect = Effect.succeed(null);

    await expect(loadPageState()).rejects.toMatchObject({
      _tag: "RedirectError",
      to: "/en-US/auth/sign-in",
    });
  });

  test("renders the unavailable state when the authoritative session read fails", async () => {
    currentUserEffect = Effect.fail(new Error("boom"));

    await expect(loadPageState()).resolves.toEqual({ kind: "unavailable" });
  });

  test("renders the completion state when no Dotypos profile matches", async () => {
    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "link-required",
      linkReason: "not-found",
    });

    await expect(loadPageState()).resolves.toEqual({
      kind: "completion-required",
      email: "ada@example.test",
    });
  });

  test("renders the support state for ambiguous, unusable, claimed, and unverified outcomes", async () => {
    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "link-required",
      linkReason: "ambiguous",
    });
    await expect(loadPageState()).resolves.toEqual({
      kind: "support-required",
      email: "ada@example.test",
    });

    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "link-required",
      linkReason: "unusable",
    });
    await expect(loadPageState()).resolves.toEqual({
      kind: "support-required",
      email: "ada@example.test",
    });

    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "link-required",
      linkReason: "claimed",
    });
    await expect(loadPageState()).resolves.toEqual({
      kind: "support-required",
      email: "ada@example.test",
    });

    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "unverified-email",
    });
    await expect(loadPageState()).resolves.toEqual({
      kind: "support-required",
      email: "ada@example.test",
    });
  });

  test("renders the retryable deletion state when the durable marker is set", async () => {
    currentUserEffect = Effect.succeed({
      ...activeSession,
      deletionRequested: true,
    });

    await expect(loadPageState()).resolves.toEqual({
      kind: "deletion-pending",
      email: "ada@example.test",
    });
  });

  test("renders the linked account with profile and grouped history", async () => {
    await expect(loadPageState()).resolves.toMatchObject({
      kind: "linked",
      email: "ada@example.test",
      profile: { firstName: "Ada" },
      history: { kind: "available" },
    });
  });

  test("keeps the profile available and marks history unavailable when the provider fails", async () => {
    historyEffect = Effect.fail(new Error("dotypos down"));

    await expect(loadPageState()).resolves.toEqual({
      kind: "linked",
      email: "ada@example.test",
      profile: {
        firstName: "Ada",
        lastName: "Lovelace",
        phone: null,
        billing: null,
      },
      history: { kind: "unavailable", reason: "provider-unavailable" },
    });
  });

  test("renders the authenticated unavailable state when the profile read fails after a successful link", async () => {
    const failingProfileLayer = Layer.succeed(Profile, {
      load: () => Effect.fail(new Error("profile gone")),
    });
    Object.assign(Profile, { Live: failingProfileLayer });

    await expect(loadPageState()).resolves.toEqual({
      kind: "authenticated-unavailable",
      email: "ada@example.test",
    });

    Object.assign(Profile, { Live: ProfileLayer });
  });

  test("renders the authenticated unavailable state for an unexpected resolver failure", async () => {
    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "unexpected",
    });

    await expect(loadPageState()).resolves.toEqual({
      kind: "authenticated-unavailable",
      email: "ada@example.test",
    });
  });
});
