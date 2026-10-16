import { testEmailAddress } from "@deskohub/test-email";
import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { Context, Effect, Layer, Predicate } from "effect";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { ReferralFeatureFlagService } from "@/features/referrals/referral-feature-flag.service";

const customerEmail = testEmailAddress("ada");

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
  email: customerEmail,
  deletionRequested: false,
};

let resolveEffect: Effect.Effect<
  {
    readonly account: {
      readonly accountId: CustomerAccountId;
      readonly dotyposCustomerId: string;
    };
    readonly autoLinked: boolean;
  },
  { readonly reason: string; readonly linkReason?: string }
>;
let resolverCalls = 0;
let events: string[] = [];
let profileLoadCalls = 0;
let historyLoadCalls = 0;
let avatarLookupCalls = 0;

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
    | {
        readonly kind: "success";
        readonly customerId: string;
        readonly autoLinked?: boolean;
      }
    | {
        readonly kind: "failure";
        readonly reason: string;
        readonly linkReason?: string;
      }
) =>
  outcome.kind === "success"
    ? Effect.succeed({
        account: { accountId, dotyposCustomerId: outcome.customerId },
        autoLinked: outcome.autoLinked ?? false,
      })
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
  load: () => {
    profileLoadCalls += 1;
    return profileLoadEffect;
  },
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
  load: () => {
    historyLoadCalls += 1;
    return historyEffect;
  },
});
Object.assign(History, { Live: HistoryLayer });

mock.module(
  "@/features/account/backend/customer-authentication.service",
  () => ({
    CustomerAuthentication: Authentication,
  })
);
mock.module(
  "@/features/account/backend/customer-account-resolver.service",
  () => ({
    resolveCurrentCustomerAccount: Effect.suspend(() => {
      resolverCalls += 1;
      return resolveEffect.pipe(
        Effect.ensuring(Effect.sync(() => events.push("resolved")))
      );
    }),
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

let avatarLookupEffect: Effect.Effect<
  { readonly url: string; readonly version?: number } | null,
  unknown
>;

const Avatar = Context.Service<
  Avatar,
  {
    readonly lookup: (
      accountId: CustomerAccountId
    ) => typeof avatarLookupEffect;
  }
>()("@test/AccountAvatar");

const AvatarLayer = Layer.succeed(Avatar, {
  lookup: () => {
    avatarLookupCalls += 1;
    return avatarLookupEffect;
  },
});
Object.assign(Avatar, { Live: AvatarLayer });

mock.module("@/features/account/backend/customer-avatar.service", () => ({
  CustomerAvatarService: Avatar,
}));

const referralSummary = {
  code: "RFL12345",
  inviteeCount: 0,
  eligibleInviteeCount: 0,
  discount: "0",
  savings: [],
} as const;
let referralSummaryEffect: Effect.Effect<typeof referralSummary, unknown>;
let referralSummaryCalls: Array<{
  readonly customerAccountId: CustomerAccountId;
  readonly dotyposCustomerId: string;
}> = [];
let availableReferralCodeEffect: Effect.Effect<string | undefined, unknown>;
let availableReferralCodeCalls: Array<{ readonly code: unknown }> = [];
let acceptReferralEffect: Effect.Effect<unknown, { readonly reason: string }>;
let settledReferralEffect: Effect.Effect<boolean, unknown>;
let settledReferralCalls: Array<{ readonly dotyposCustomerId: string }> = [];
let acceptReferralCalls: Array<{
  readonly code: unknown;
  readonly customerAccountId: CustomerAccountId;
  readonly dotyposCustomerId: string;
}> = [];
type TestReferralService = {
  readonly getAccountSummary: (input: {
    readonly customerAccountId: CustomerAccountId;
    readonly dotyposCustomerId: string;
  }) => typeof referralSummaryEffect;
  readonly findAvailableCode: (input: {
    readonly code: unknown;
  }) => typeof availableReferralCodeEffect;
  readonly acceptReferral: (
    input: (typeof acceptReferralCalls)[number]
  ) => typeof acceptReferralEffect;
  readonly hasSettledReferral: (input: {
    readonly dotyposCustomerId: string;
  }) => typeof settledReferralEffect;
};
const Referrals = Context.Service<Referrals, TestReferralService>()(
  "@test/AccountReferrals"
);
const ReferralsLayer = Layer.succeed(Referrals, {
  getAccountSummary: (input) => {
    referralSummaryCalls.push(input);
    events.push("summary");
    return referralSummaryEffect;
  },
  acceptReferral: (input) => {
    acceptReferralCalls.push(input);
    events.push("accept");
    return acceptReferralEffect;
  },
  findAvailableCode: (input) => {
    availableReferralCodeCalls.push(input);
    return availableReferralCodeEffect;
  },
  hasSettledReferral: (input) => {
    settledReferralCalls.push(input);
    events.push("settled");
    return settledReferralEffect;
  },
});
Object.assign(Referrals, { Live: ReferralsLayer });
mock.module("@/features/referrals", () => ({ ReferralService: Referrals }));
mock.module("@/shared/backend/config/workspace-url.config", () => ({
  getWorkspaceRuntimeCallbackOrigin: Effect.succeed(
    new URL("https://workspace.example")
  ),
}));
const accountReferrals = {
  summary: referralSummary,
  shareUrl: "https://workspace.example/account?ref=RFL12345",
};

type StoredSignupIntent = {
  readonly code: string;
  readonly promotionCodeId: string;
  readonly referrerDotyposCustomerId: string;
  readonly outcome?: string | null;
  readonly acknowledged?: boolean;
};
let storedSignupIntent: StoredSignupIntent | undefined;
const SignupIntents = Context.Service<
  SignupIntents,
  {
    readonly find: (accountId: CustomerAccountId) => Effect.Effect<
      | (StoredSignupIntent & {
          readonly outcome: string | null;
          readonly acknowledged: boolean;
        })
      | undefined
    >;
    readonly settle: (
      accountId: CustomerAccountId,
      promotionCodeId: string,
      outcome: string
    ) => Effect.Effect<boolean>;
  }
>()("@test/AccountSignupIntents");
Object.assign(SignupIntents, {
  Live: Layer.succeed(SignupIntents, {
    find: () =>
      Effect.sync(() =>
        storedSignupIntent
          ? {
              ...storedSignupIntent,
              outcome: storedSignupIntent.outcome ?? null,
              acknowledged: storedSignupIntent.acknowledged ?? false,
            }
          : undefined
      ),
    settle: (_accountId, _promotionCodeId, outcome) =>
      Effect.sync(() => {
        if (!storedSignupIntent || (storedSignupIntent.outcome ?? null)) {
          return false;
        }
        storedSignupIntent = { ...storedSignupIntent, outcome };
        return true;
      }),
  }),
});
mock.module("@/features/referrals/signup-intent.repository", () => ({
  ReferralSignupIntentRepository: SignupIntents,
}));

let rememberedReferralCode: string | undefined;
let rememberedReferralCodeReads = 0;
mock.module("@/features/referrals/remembered-referral-code.server", () => ({
  readRememberedReferralCode: Effect.promise(async () => {
    rememberedReferralCodeReads += 1;
    const { parseReferralCode } = await import("@/features/referrals/client");
    return parseReferralCode(rememberedReferralCode);
  }),
}));

const areAccountAvatarsEnabled = mock(() => Promise.resolve(true));
const arePasskeysEnabled = mock(() => Promise.resolve(false));
mock.module("@/features/account/server/account-feature-flag.server", () => ({
  areAccountAvatarsEnabled,
  arePasskeysEnabled,
}));

const accountPasskey = {
  id: "passkey-1",
  name: "Google Password Manager",
  provider: "Google Password Manager",
  createdAt: "2026-10-14T16:40:00.000Z",
} as const;
let passkeyListEffect: Effect.Effect<
  readonly (typeof accountPasskey)[],
  unknown
>;
let passkeyListCalls = 0;
const Passkeys = Context.Service<
  Passkeys,
  { readonly list: typeof passkeyListEffect }
>()("@test/CustomerPasskeys");
Object.assign(Passkeys, {
  Default: Layer.succeed(Passkeys, {
    list: Effect.suspend(() => {
      passkeyListCalls += 1;
      return passkeyListEffect;
    }),
  }),
});
mock.module(
  "@/features/account/backend/auth/customer-passkeys.service",
  () => ({ CustomerPasskeys: Passkeys })
);
const areReferralsEnabled = mock(() => Promise.resolve(true));
mock.module("@/features/referrals/referral-feature-flag.server", () => ({
  areReferralsEnabled,
  ReferralFeatureFlagRequest: Layer.unwrap(
    Effect.promise(areReferralsEnabled).pipe(
      Effect.map(ReferralFeatureFlagService.fromDecision)
    )
  ),
}));
const runtimeRuns: { operation: string; boundary: string }[] = [];
mock.module("@/shared/backend/workspace-effect", () => ({
  runWorkspaceEffect:
    (operation: string, options: { readonly boundary: string }) =>
    (effect: Effect.Effect<unknown, unknown, never>) => {
      runtimeRuns.push({ operation, boundary: options.boundary });
      return Effect.runPromise(effect);
    },
}));

describe("loadCustomerAccountPage", () => {
  beforeEach(() => {
    currentUserEffect = Effect.succeed(activeSession);
    resolveEffect = resolverOutcome({ kind: "success", customerId: "60111" });
    resolverCalls = 0;
    profileLoadCalls = 0;
    historyLoadCalls = 0;
    avatarLookupCalls = 0;
    runtimeRuns.length = 0;
    avatarLookupEffect = Effect.succeed(null);
    referralSummaryEffect = Effect.succeed(referralSummary);
    referralSummaryCalls = [];
    availableReferralCodeEffect = Effect.succeed("RFL12345");
    availableReferralCodeCalls = [];
    acceptReferralEffect = Effect.succeed({ status: "accepted" });
    acceptReferralCalls = [];
    settledReferralEffect = Effect.succeed(false);
    settledReferralCalls = [];
    rememberedReferralCode = undefined;
    rememberedReferralCodeReads = 0;
    storedSignupIntent = undefined;
    events = [];
    areAccountAvatarsEnabled.mockReset();
    areAccountAvatarsEnabled.mockResolvedValue(true);
    arePasskeysEnabled.mockReset();
    arePasskeysEnabled.mockResolvedValue(false);
    passkeyListEffect = Effect.succeed([accountPasskey]);
    passkeyListCalls = 0;
    areReferralsEnabled.mockReset();
    areReferralsEnabled.mockResolvedValue(true);
    historyEffect = Effect.succeed({
      kind: "available",
      groups: { current: [], past: [], unavailable: [] },
    });
  });

  const loadPageState = async (remembered?: string) => {
    rememberedReferralCode = remembered;
    const { loadCustomerAccountPage } = await import("./page-data.server");
    return loadCustomerAccountPage();
  };

  test("returns unauthenticated without customer data or downstream work when no session exists", async () => {
    currentUserEffect = Effect.succeed(null);

    await expect(loadPageState()).resolves.toEqual({
      kind: "unauthenticated",
    });
    expect(resolverCalls).toBe(0);
    expect(profileLoadCalls).toBe(0);
    expect(historyLoadCalls).toBe(0);
  });

  test("returns unauthenticated without customer data when resolution reports no session", async () => {
    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "unauthenticated",
    });

    await expect(loadPageState()).resolves.toEqual({
      kind: "unauthenticated",
    });
    expect(resolverCalls).toBe(1);
    expect(profileLoadCalls).toBe(0);
    expect(historyLoadCalls).toBe(0);
  });

  test("prefills a currently usable remembered referral code on the completion state", async () => {
    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "link-required",
      linkReason: "not-found",
    });

    await expect(loadPageState("RFL12345")).resolves.toEqual({
      kind: "completion-required",
      referralsEnabled: true,
      email: customerEmail,
      referralCode: "RFL12345",
    });
    expect(availableReferralCodeCalls).toEqual([{ code: "RFL12345" }]);
  });

  test("silently leaves the completion referral empty when the remembered code is not usable", async () => {
    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "link-required",
      linkReason: "not-found",
    });

    availableReferralCodeEffect = Effect.succeed(undefined);
    await expect(loadPageState("RFLGONE1")).resolves.toEqual({
      kind: "completion-required",
      referralsEnabled: true,
      email: customerEmail,
    });

    availableReferralCodeEffect = Effect.fail(new Error("database down"));
    await expect(loadPageState("RFL12345")).resolves.toEqual({
      kind: "completion-required",
      referralsEnabled: true,
      email: customerEmail,
    });
  });

  test("records nothing from a remembered code once the account is linked", async () => {
    const state = await loadPageState("RFL12345");

    expect(state.kind).toBe("linked");
    expect(state).not.toHaveProperty("referralCode");
    expect(availableReferralCodeCalls).toEqual([]);
    expect(acceptReferralCalls).toEqual([]);
  });

  test("records the remembered invitation after this sign-in linked an existing customer", async () => {
    resolveEffect = resolverOutcome({
      kind: "success",
      customerId: "60111",
      autoLinked: true,
    });

    const state = await loadPageState("RFL12345");

    expect(state).toMatchObject({
      kind: "linked",
      referrals: accountReferrals,
    });
    expect(acceptReferralCalls).toEqual([
      {
        code: "RFL12345",
        customerAccountId: accountId,
        dotyposCustomerId: "60111",
      },
    ]);
    expect(events).toEqual(["resolved", "accept", "settled", "summary"]);
  });

  test("retries the code a profile completion could not record yet, after resolution", async () => {
    storedSignupIntent = {
      code: "RFLPENDING",
      promotionCodeId: "@test/promotion-code-id",
      referrerDotyposCustomerId: "70001",
    };

    const state = await loadPageState();

    expect(state.kind).toBe("linked");
    expect(acceptReferralCalls).toEqual([
      {
        code: "RFLPENDING",
        customerAccountId: accountId,
        dotyposCustomerId: "60111",
      },
    ]);
    expect(events).toEqual(["resolved", "accept", "summary"]);
    expect(storedSignupIntent?.outcome).toBe("applied");
  });

  test("keeps showing a code settled as applied on later visits, without retrying, until acknowledged", async () => {
    storedSignupIntent = {
      code: "RFLPENDING",
      promotionCodeId: "@test/promotion-code-id",
      referrerDotyposCustomerId: "70001",
    };
    acceptReferralEffect = Effect.fail({ reason: "pending_payment" });

    await expect(loadPageState()).resolves.toMatchObject({
      kind: "linked",
      signupReferral: { status: "pending" },
    });
    expect(storedSignupIntent?.outcome ?? null).toBeNull();

    acceptReferralEffect = Effect.succeed({ status: "accepted" });
    // The visit that settles the code may never reach the browser.
    await loadPageState();
    expect(storedSignupIntent?.outcome).toBe("applied");

    await expect(loadPageState()).resolves.toMatchObject({
      kind: "linked",
      signupReferral: { status: "applied" },
    });
    expect(acceptReferralCalls).toHaveLength(2);

    storedSignupIntent = { ...storedSignupIntent!, acknowledged: true };
    const acknowledged = await loadPageState();
    expect(acknowledged.kind).toBe("linked");
    expect(acknowledged).not.toHaveProperty("signupReferral");
  });

  test("keeps showing a code settled as rejected after the first booking is paid, until acknowledged", async () => {
    storedSignupIntent = {
      code: "RFLPENDING",
      promotionCodeId: "@test/promotion-code-id",
      referrerDotyposCustomerId: "70001",
    };
    acceptReferralEffect = Effect.fail({ reason: "ineligible" });

    await expect(loadPageState()).resolves.toMatchObject({
      kind: "linked",
      signupReferral: { status: "not-applied", reason: "not-eligible" },
    });
    await expect(loadPageState()).resolves.toMatchObject({
      kind: "linked",
      signupReferral: { status: "not-applied", reason: "not-eligible" },
    });
    expect(acceptReferralCalls).toHaveLength(1);

    storedSignupIntent = { ...storedSignupIntent!, acknowledged: true };
    expect(await loadPageState()).not.toHaveProperty("signupReferral");
  });

  test("leaves a stored code unsettled when the linked page cannot render", async () => {
    storedSignupIntent = {
      code: "RFLPENDING",
      promotionCodeId: "@test/promotion-code-id",
      referrerDotyposCustomerId: "70001",
    };
    Object.assign(Profile, {
      Live: Layer.succeed(Profile, {
        load: () => Effect.fail(new Error("provider down")),
      }),
    });
    try {
      await expect(loadPageState()).resolves.toMatchObject({
        kind: "authenticated-unavailable",
      });
      expect(acceptReferralCalls).toEqual([]);
      expect(storedSignupIntent).toBeDefined();
    } finally {
      Object.assign(Profile, { Live: ProfileLayer });
    }
  });

  test("records nothing when an auto-linked sign-in has no remembered code", async () => {
    resolveEffect = resolverOutcome({
      kind: "success",
      customerId: "60111",
      autoLinked: true,
    });

    await expect(loadPageState()).resolves.toMatchObject({ kind: "linked" });
    expect(acceptReferralCalls).toEqual([]);
  });

  test("keeps the linked page and logs only a fixed reason when the invitation is not recorded", async () => {
    resolveEffect = resolverOutcome({
      kind: "success",
      customerId: "60111",
      autoLinked: true,
    });
    const lines: string[] = [];
    const capture = (...args: unknown[]) => {
      lines.push(
        args
          .map((arg) => (Predicate.isString(arg) ? arg : JSON.stringify(arg)))
          .join(" ")
      );
    };
    const spies = [
      spyOn(console, "log").mockImplementation(capture),
      spyOn(console, "warn").mockImplementation(capture),
      spyOn(console, "error").mockImplementation(capture),
    ];

    try {
      for (const reason of [
        "unavailable",
        "self_referral",
        "ineligible",
        "already_attributed",
      ]) {
        acceptReferralEffect = Effect.fail({ reason });
        await expect(loadPageState("RFLSHARE")).resolves.toMatchObject({
          kind: "linked",
          profile: { firstName: "Ada" },
          referrals: accountReferrals,
        });
      }
      acceptReferralEffect = Effect.die(new Error("referral store down"));
      await expect(loadPageState("RFLSHARE")).resolves.toMatchObject({
        kind: "linked",
        referrals: accountReferrals,
      });
    } finally {
      for (const spy of spies) spy.mockRestore();
    }

    const output = lines.filter((line) => line.includes("WARN")).join("\n");
    expect(output).toContain("account.auto-link.referral");
    expect(output).toContain("self_referral");
    expect(output).toContain("ineligible");
    expect(output).toContain("already_attributed");
    expect(output).not.toContain("RFLSHARE");
    expect(output).not.toContain("referral store down");
  });

  test("forgets the remembered code once the linked customer's referral is settled", async () => {
    resolveEffect = resolverOutcome({
      kind: "success",
      customerId: "60111",
      autoLinked: true,
    });
    storedSignupIntent = {
      code: "RFLPENDING",
      promotionCodeId: "@test/promotion-code-id",
      referrerDotyposCustomerId: "70001",
    };
    settledReferralEffect = Effect.succeed(true);

    await expect(loadPageState("RFL12345")).resolves.toMatchObject({
      kind: "linked",
      rememberedReferralCodeUsed: true,
    });
    expect(settledReferralCalls).toEqual([{ dotyposCustomerId: "60111" }]);
    expect(events).toEqual([
      "resolved",
      "accept",
      "accept",
      "settled",
      "summary",
    ]);
  });

  test("keeps the remembered code while the linked customer's referral is open or unknown", async () => {
    const open = await loadPageState("RFL12345");
    expect(open.kind).toBe("linked");
    expect(open).not.toHaveProperty("rememberedReferralCodeUsed");

    settledReferralEffect = Effect.fail(new Error("dotypos down"));
    const unknown = await loadPageState("RFL12345");
    expect(unknown).toMatchObject({
      kind: "linked",
      referrals: accountReferrals,
    });
    expect(unknown).not.toHaveProperty("rememberedReferralCodeUsed");
    expect(settledReferralCalls).toHaveLength(2);
  });

  test("never checks whether the referral is settled without a remembered code", async () => {
    settledReferralEffect = Effect.succeed(true);

    const state = await loadPageState();

    expect(state.kind).toBe("linked");
    expect(state).not.toHaveProperty("rememberedReferralCodeUsed");
    expect(settledReferralCalls).toEqual([]);
  });

  test("renders the support state for ambiguous, unusable, claimed, and unverified outcomes", async () => {
    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "link-required",
      linkReason: "ambiguous",
    });
    await expect(loadPageState()).resolves.toEqual({
      kind: "support-required",
      email: customerEmail,
    });

    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "link-required",
      linkReason: "unusable",
    });
    await expect(loadPageState()).resolves.toEqual({
      kind: "support-required",
      email: customerEmail,
    });

    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "link-required",
      linkReason: "claimed",
    });
    await expect(loadPageState()).resolves.toEqual({
      kind: "support-required",
      email: customerEmail,
    });

    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "unverified-email",
    });
    await expect(loadPageState()).resolves.toEqual({
      kind: "support-required",
      email: customerEmail,
    });
  });

  test("renders the retryable deletion state when the durable marker is set", async () => {
    currentUserEffect = Effect.succeed({
      ...activeSession,
      deletionRequested: true,
    });

    await expect(loadPageState()).resolves.toEqual({
      kind: "deletion-pending",
      email: customerEmail,
    });
  });

  test("renders the linked account with profile and grouped history, in one page-boundary run", async () => {
    await expect(loadPageState()).resolves.toEqual({
      kind: "linked",
      referralsEnabled: true,
      email: customerEmail,
      profile: {
        firstName: "Ada",
        lastName: "Lovelace",
        phone: null,
        billing: null,
      },
      avatar: { kind: "available", avatar: null },
      history: {
        kind: "available",
        groups: { current: [], past: [], unavailable: [] },
      },
      referrals: accountReferrals,
    });
    expect(referralSummaryCalls).toEqual([
      { customerAccountId: accountId, dotyposCustomerId: "60111" },
    ]);
    expect(runtimeRuns).toEqual([
      { operation: "account.page", boundary: "page" },
    ]);
  });

  test("logs fixed, cause-free warnings when history and avatar degrade", async () => {
    historyEffect = Effect.fail(new Error("dotypos down"));
    avatarLookupEffect = Effect.fail(new Error("cloudinary down"));
    const lines: string[] = [];
    const capture = (...args: unknown[]) => {
      lines.push(
        args
          .map((arg) => (Predicate.isString(arg) ? arg : JSON.stringify(arg)))
          .join(" ")
      );
    };
    const spies = [
      spyOn(console, "log").mockImplementation(capture),
      spyOn(console, "warn").mockImplementation(capture),
      spyOn(console, "error").mockImplementation(capture),
    ];

    try {
      await expect(loadPageState()).resolves.toMatchObject({
        kind: "linked",
        avatar: { kind: "available", avatar: null },
        history: { kind: "unavailable", reason: "provider-unavailable" },
      });
    } finally {
      for (const spy of spies) spy.mockRestore();
    }

    const output = lines.filter((line) => line.includes("WARN")).join("\n");
    expect(output).toContain("account.reservation-history.unavailable");
    expect(output).toContain("account.avatar.unavailable");
    expect(output).not.toContain("dotypos down");
    expect(output).not.toContain("cloudinary down");
  });

  test("keeps profile and history available while hiding avatars and skipping lookup when disabled", async () => {
    areAccountAvatarsEnabled.mockResolvedValue(false);

    await expect(loadPageState()).resolves.toEqual({
      kind: "linked",
      referralsEnabled: true,
      email: customerEmail,
      profile: {
        firstName: "Ada",
        lastName: "Lovelace",
        phone: null,
        billing: null,
      },
      avatar: { kind: "hidden" },
      history: {
        kind: "available",
        groups: { current: [], past: [], unavailable: [] },
      },
      referrals: accountReferrals,
    });
    expect(avatarLookupCalls).toBe(0);
    expect(profileLoadCalls).toBe(1);
    expect(historyLoadCalls).toBe(1);
  });

  test("fails closed without avatar lookup when avatar capability evaluation is unavailable", async () => {
    areAccountAvatarsEnabled.mockRejectedValue(new Error("flag unavailable"));

    await expect(loadPageState()).resolves.toMatchObject({
      kind: "linked",
      avatar: { kind: "hidden" },
      profile: { firstName: "Ada" },
      history: { kind: "available" },
    });
    expect(avatarLookupCalls).toBe(0);
  });

  test("lists the account's passkeys only while passkeys are on", async () => {
    await expect(loadPageState()).resolves.not.toHaveProperty("passkeys");
    expect(passkeyListCalls).toBe(0);

    arePasskeysEnabled.mockResolvedValue(true);
    await expect(loadPageState()).resolves.toMatchObject({
      kind: "linked",
      passkeys: { accountId, passkeys: [accountPasskey] },
    });
    expect(passkeyListCalls).toBe(1);
  });

  test("keeps the linked page with an unavailable passkey list", async () => {
    arePasskeysEnabled.mockResolvedValue(true);
    passkeyListEffect = Effect.fail(new Error("passkeys down"));

    await expect(loadPageState()).resolves.toMatchObject({
      kind: "linked",
      profile: { firstName: "Ada" },
      passkeys: { accountId, passkeys: null },
    });
  });

  test("fails closed without listing passkeys when the flag is unavailable", async () => {
    arePasskeysEnabled.mockRejectedValue(new Error("flag unavailable"));

    await expect(loadPageState()).resolves.not.toHaveProperty("passkeys");
    expect(passkeyListCalls).toBe(0);
  });

  test("lists passkeys from the session in every signed-in state without a usable profile", async () => {
    arePasskeysEnabled.mockResolvedValue(true);
    const passkeys = { accountId, passkeys: [accountPasskey] };
    const failingProfileLayer = Layer.succeed(Profile, {
      load: () => Effect.fail(new Error("profile gone")),
    });
    Object.assign(Profile, { Live: failingProfileLayer });
    await expect(loadPageState()).resolves.toEqual({
      kind: "authenticated-unavailable",
      email: customerEmail,
      passkeys,
    });
    Object.assign(Profile, { Live: ProfileLayer });

    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "link-required",
      linkReason: "not-found",
    });
    await expect(loadPageState()).resolves.toMatchObject({
      kind: "completion-required",
      passkeys,
    });

    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "link-required",
      linkReason: "ambiguous",
    });
    await expect(loadPageState()).resolves.toEqual({
      kind: "support-required",
      email: customerEmail,
      passkeys,
    });

    currentUserEffect = Effect.succeed({
      ...activeSession,
      deletionRequested: true,
    });
    const resolutionsBeforeDeletion = resolverCalls;
    await expect(loadPageState()).resolves.toEqual({
      kind: "deletion-pending",
      email: customerEmail,
      passkeys,
    });
    expect(resolverCalls).toBe(resolutionsBeforeDeletion);
    expect(passkeyListCalls).toBe(4);
  });

  test("lists no passkeys once resolution finds no session", async () => {
    arePasskeysEnabled.mockResolvedValue(true);
    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "unauthenticated",
    });

    await expect(loadPageState()).resolves.toEqual({
      kind: "unauthenticated",
    });
    expect(passkeyListCalls).toBe(0);
  });

  test("renders the authenticated unavailable state when the profile read fails after a successful link", async () => {
    const failingProfileLayer = Layer.succeed(Profile, {
      load: () => Effect.fail(new Error("profile gone")),
    });
    Object.assign(Profile, { Live: failingProfileLayer });

    await expect(loadPageState()).resolves.toEqual({
      kind: "authenticated-unavailable",
      email: customerEmail,
    });

    Object.assign(Profile, { Live: ProfileLayer });
  });

  describe("while the referral program is withheld", () => {
    const expectNoReferralWork = () => {
      expect(rememberedReferralCodeReads).toBe(0);
      expect(availableReferralCodeCalls).toEqual([]);
      expect(acceptReferralCalls).toEqual([]);
      expect(settledReferralCalls).toEqual([]);
      expect(referralSummaryCalls).toEqual([]);
    };

    test("offers no completion referral field or prefill", async () => {
      areReferralsEnabled.mockResolvedValue(false);
      resolveEffect = resolverOutcome({
        kind: "failure",
        reason: "link-required",
        linkReason: "not-found",
      });

      await expect(loadPageState("RFL12345")).resolves.toEqual({
        kind: "completion-required",
        referralsEnabled: false,
        email: customerEmail,
      });
      expectNoReferralWork();
    });

    test("skips the auto-link acceptance, signup retry, settlement check, and summary", async () => {
      areReferralsEnabled.mockResolvedValue(false);
      resolveEffect = resolverOutcome({
        kind: "success",
        customerId: "60111",
        autoLinked: true,
      });
      const unsettledIntent = {
        code: "RFLPENDING",
        promotionCodeId: "@test/promotion-code-id",
        referrerDotyposCustomerId: "70001",
      };
      storedSignupIntent = unsettledIntent;
      settledReferralEffect = Effect.succeed(true);

      const state = await loadPageState("RFL12345");

      expect(state).toEqual({
        kind: "linked",
        email: customerEmail,
        profile: {
          firstName: "Ada",
          lastName: "Lovelace",
          phone: null,
          billing: null,
        },
        avatar: { kind: "available", avatar: null },
        history: {
          kind: "available",
          groups: { current: [], past: [], unavailable: [] },
        },
        referralsEnabled: false,
        referrals: undefined,
      });
      expect(state).not.toHaveProperty("signupReferral");
      expect(state).not.toHaveProperty("rememberedReferralCodeUsed");
      expect(storedSignupIntent).toBe(unsettledIntent);
      expect(events).toEqual(["resolved"]);
      expectNoReferralWork();
    });

    test("decides the referral program once for the whole load", async () => {
      resolveEffect = resolverOutcome({
        kind: "success",
        customerId: "60111",
        autoLinked: true,
      });

      await expect(loadPageState("RFL12345")).resolves.toMatchObject({
        kind: "linked",
        referralsEnabled: true,
      });
      // The page gate and every referral service of this load share one
      // decision, so none of them can see the program differently.
      expect(areReferralsEnabled).toHaveBeenCalledTimes(1);
    });
  });
});
