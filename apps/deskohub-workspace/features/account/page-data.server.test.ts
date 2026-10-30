import { testEmailAddress } from "@deskohub/test-email";
import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { Cause, Effect, Layer, Predicate } from "effect";
import { redirect } from "next/navigation";
import { AccountFeatureFlagService } from "@/features/account/backend/account-feature-flag.service";
import { CustomerAgentConnections } from "@/features/account/backend/auth/customer-agent-connections.service";
import { CustomerPasskeys } from "@/features/account/backend/auth/customer-passkeys.service";
import { CustomerAccountContactService } from "@/features/account/backend/customer-account-contact.service";
import { CustomerAccountResolver } from "@/features/account/backend/customer-account-resolver.service";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { CustomerAvatarService } from "@/features/account/backend/customer-avatar.service";
import { CustomerProfileService } from "@/features/account/backend/customer-profile.service";
import {
  CustomerReservationHistoryService,
  type ReservationHistoryAccount,
} from "@/features/account/backend/customer-reservation-history.service";
import {
  CustomerAccountAccessError,
  type CustomerAccountId,
} from "@/features/account/customer-account";
import type { CustomerAgentConnection } from "@/features/account/customer-agent-connections";
import { WorkspaceFeatureFlagServiceMock } from "@/features/feature-flags/backend/workspace-feature-flag.service.mock";
import {
  getReferralShareUrl,
  type ReferralCode,
} from "@/features/referrals/client";
import { ReferralError } from "@/features/referrals/contracts";
import { ReferralServiceMock } from "@/features/referrals/referral.service.mock";
import { ReferralFeatureFlagService } from "@/features/referrals/referral-feature-flag.service";
import { RememberedReferral } from "@/features/referrals/remembered-referral.service";
import { ReferralSignupIntentRepository } from "@/features/referrals/signup-intent.repository";
import { ReviewAccountsMock } from "@/features/review-accounts/backend/review-accounts.repository.mock";
import { getWorkspaceRuntimeCallbackOrigin } from "@/shared/backend/config/workspace-url.config";
import { findNextControlFlow } from "@/shared/backend/workspace-effect";
import {
  type AccountPageLayers,
  accountPageCapabilities,
} from "./account-page-capabilities.server";
import { loadAccountPageState } from "./page-data.server";

const customerEmail = testEmailAddress("ada");

let currentUserEffect: Effect.Effect<
  {
    readonly accountId: CustomerAccountId;
    readonly email: string;
    readonly deletionRequested: boolean;
  } | null,
  unknown
>;

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
  CustomerAccountAccessError
>;
let resolverCalls = 0;
let events: string[] = [];
let profileLoadCalls = 0;
let historyLoadCalls = 0;
let historyLoadAccounts: ReservationHistoryAccount[] = [];
let avatarLookupCalls = 0;

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
): typeof resolveEffect =>
  outcome.kind === "success"
    ? Effect.succeed({
        account: { accountId, dotyposCustomerId: outcome.customerId },
        autoLinked: outcome.autoLinked ?? false,
      })
    : Effect.fail(
        new CustomerAccountAccessError({
          reason: outcome.reason,
          linkReason: outcome.linkReason,
        } as never)
      );

const linkedProfile = Effect.succeed({
  firstName: "Ada",
  lastName: "Lovelace",
  phone: null,
  billing: null,
});
let profileLoadEffect: Effect.Effect<
  Effect.Success<typeof linkedProfile>,
  unknown
>;

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

let reviewAccountEffect: Effect.Effect<boolean, unknown>;

let avatarLookupEffect: Effect.Effect<
  { readonly url: string; readonly version?: number } | null,
  unknown
>;

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
let acceptReferralEffect: Effect.Effect<unknown, ReferralError>;
let settledReferralEffect: Effect.Effect<boolean, unknown>;
let settledReferralCalls: Array<{ readonly dotyposCustomerId: string }> = [];
let acceptReferralCalls: Array<{
  readonly code: unknown;
  readonly customerAccountId: CustomerAccountId;
  readonly dotyposCustomerId: string;
}> = [];
const accountReferrals = {
  summary: referralSummary,
  shareUrl: getReferralShareUrl(
    referralSummary.code as ReferralCode,
    Effect.runSync(getWorkspaceRuntimeCallbackOrigin)
  ),
};

type StoredSignupIntent = {
  readonly code: string;
  readonly promotionCodeId: string;
  readonly referrerDotyposCustomerId: string;
  readonly outcome?: string | null;
  readonly acknowledged?: boolean;
};
let storedSignupIntent: StoredSignupIntent | undefined;

let rememberedReferralCode: string | undefined;
let rememberedReferralCodeReads = 0;
const cookieWithCountingGetter = {
  get value() {
    rememberedReferralCodeReads += 1;
    return rememberedReferralCode;
  },
};

const avatarsFlag = mock(() => Promise.resolve(true));
const passkeysFlag = mock(() => Promise.resolve(false));
const referralsFlag = mock(() => Promise.resolve(true));

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
let assistantListEffect: Effect.Effect<
  readonly CustomerAgentConnection[],
  unknown
>;
let assistantListCalls = 0;

/** Layers a test replaces, such as one whose build fails. */
let layerOverrides: Partial<AccountPageLayers> = {};

const flagValues = {
  account_avatars: avatarsFlag,
  login_passkeys: passkeysFlag,
} as const;

/**
 * The page's layers over the test's fakes, built through the page's own
 * composition.
 */
const pageLayer = () =>
  accountPageCapabilities({
    authentication: Layer.mock(CustomerAuthentication, {
      currentUser: Effect.suspend(() => currentUserEffect) as never,
    }),
    resolver: Layer.mock(CustomerAccountResolver, {
      resolveLink: Effect.suspend(() => {
        resolverCalls += 1;
        return resolveEffect.pipe(
          Effect.ensuring(Effect.sync(() => events.push("resolved")))
        );
      }) as never,
    }),
    profile: Layer.mock(CustomerProfileService, {
      load: () => {
        profileLoadCalls += 1;
        return profileLoadEffect as never;
      },
    }),
    history: Layer.mock(CustomerReservationHistoryService, {
      load: (account) => {
        historyLoadCalls += 1;
        historyLoadAccounts.push(account);
        return historyEffect as never;
      },
    }),
    avatar: Layer.mock(CustomerAvatarService, {
      lookup: () => {
        avatarLookupCalls += 1;
        return avatarLookupEffect as never;
      },
    }),
    referrals: ReferralServiceMock({
      getAccountSummary: (input) => {
        referralSummaryCalls.push(input);
        events.push("summary");
        return referralSummaryEffect as never;
      },
      acceptReferral: (input) => {
        acceptReferralCalls.push(input);
        events.push("accept");
        return acceptReferralEffect as never;
      },
      findAvailableCode: (input) => {
        availableReferralCodeCalls.push(input);
        return availableReferralCodeEffect as never;
      },
      hasSettledReferral: (input) => {
        settledReferralCalls.push(input);
        events.push("settled");
        return settledReferralEffect as never;
      },
    }),
    assistants: Layer.mock(CustomerAgentConnections, {
      list: Effect.suspend(() => {
        assistantListCalls += 1;
        return assistantListEffect;
      }) as never,
    }),
    featureFlags: AccountFeatureFlagService.Default.pipe(
      Layer.provide(
        WorkspaceFeatureFlagServiceMock({
          isEnabled: (key) =>
            Effect.tryPromise(() =>
              key in flagValues
                ? flagValues[key as keyof typeof flagValues]()
                : Promise.reject(new Error(`unexpected flag ${key}`))
            ) as never,
        })
      )
    ),
    passkeys: Layer.mock(CustomerPasskeys, {
      list: Effect.suspend(() => {
        passkeyListCalls += 1;
        return passkeyListEffect;
      }) as never,
    }),
    reviewAccounts: ReviewAccountsMock({
      isReviewAccount: () => reviewAccountEffect as never,
    }),
    signupIntents: Layer.mock(ReferralSignupIntentRepository, {
      find: () =>
        Effect.sync(() =>
          storedSignupIntent
            ? {
                ...storedSignupIntent,
                outcome: storedSignupIntent.outcome ?? null,
                acknowledged: storedSignupIntent.acknowledged ?? false,
              }
            : undefined
        ) as never,
      settle: (_accountId, _promotionCodeId, outcome) =>
        Effect.sync(() => {
          if (!storedSignupIntent || (storedSignupIntent.outcome ?? null)) {
            return false;
          }
          storedSignupIntent = { ...storedSignupIntent, outcome };
          return true;
        }),
    }),
    rememberedReferral: RememberedReferral.inMemory(
      cookieWithCountingGetter
    ).pipe(Layer.provide(Layer.mock(CustomerAccountContactService, {}))),
    referralRelease: Layer.unwrap(
      Effect.promise(() => referralsFlag()).pipe(
        Effect.map(ReferralFeatureFlagService.fromDecision)
      )
    ),
    ...layerOverrides,
  });

describe("loadAccountPageState", () => {
  beforeEach(() => {
    currentUserEffect = Effect.succeed(activeSession);
    resolveEffect = resolverOutcome({ kind: "success", customerId: "60111" });
    resolverCalls = 0;
    profileLoadCalls = 0;
    profileLoadEffect = linkedProfile;
    historyLoadCalls = 0;
    historyLoadAccounts = [];
    avatarLookupCalls = 0;
    layerOverrides = {};
    avatarLookupEffect = Effect.succeed(null);
    reviewAccountEffect = Effect.succeed(false);
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
    avatarsFlag.mockReset();
    avatarsFlag.mockResolvedValue(true);
    passkeysFlag.mockReset();
    passkeysFlag.mockResolvedValue(false);
    passkeyListEffect = Effect.succeed([accountPasskey]);
    passkeyListCalls = 0;
    assistantListEffect = Effect.succeed([]);
    assistantListCalls = 0;
    referralsFlag.mockReset();
    referralsFlag.mockResolvedValue(true);
    historyEffect = Effect.succeed({
      kind: "available",
      groups: { current: [], past: [], unavailable: [] },
    });
  });

  const loadPageState = (remembered?: string) => {
    rememberedReferralCode = remembered;
    return Effect.runPromise(
      loadAccountPageState.pipe(Effect.provide(pageLayer()))
    );
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
      deletion: "offered",
      assistants: [],
      referralsEnabled: true,
      email: customerEmail,
      referralCode: "RFL12345",
    });
    expect(availableReferralCodeCalls).toEqual([{ code: "RFL12345" }]);
  });

  test("shows the reservations an account authored before completing its profile", async () => {
    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "link-required",
      linkReason: "not-found",
    });
    const authored = {
      id: "workspace-reservation-1",
      party: { kind: "booked-for", customerName: "Karla Ukázková" },
    };
    historyEffect = Effect.succeed({
      kind: "available",
      groups: { current: [authored], past: [], unavailable: [] },
    });

    await expect(loadPageState()).resolves.toEqual({
      kind: "completion-required",
      deletion: "offered",
      assistants: [],
      referralsEnabled: true,
      email: customerEmail,
      history: {
        kind: "available",
        groups: { current: [authored], past: [], unavailable: [] },
      },
    });
    expect(historyLoadAccounts).toEqual([{ accountId }]);
  });

  test("keeps an unreadable authored history as a notice on the completion state", async () => {
    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "link-required",
      linkReason: "not-found",
    });
    historyEffect = Effect.fail(new Error("dotypos down"));

    await expect(loadPageState()).resolves.toMatchObject({
      kind: "completion-required",
      history: { kind: "unavailable", reason: "provider-unavailable" },
    });
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
      deletion: "offered",
      assistants: [],
      referralsEnabled: true,
      email: customerEmail,
    });

    availableReferralCodeEffect = Effect.fail(new Error("database down"));
    await expect(loadPageState("RFL12345")).resolves.toEqual({
      kind: "completion-required",
      deletion: "offered",
      assistants: [],
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
    acceptReferralEffect = Effect.fail(
      new ReferralError({ reason: "pending_payment" })
    );

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
    acceptReferralEffect = Effect.fail(
      new ReferralError({ reason: "ineligible" })
    );

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
    profileLoadEffect = Effect.fail(new Error("provider down"));
    await expect(loadPageState()).resolves.toMatchObject({
      kind: "authenticated-unavailable",
    });
    expect(acceptReferralCalls).toEqual([]);
    expect(storedSignupIntent).toBeDefined();
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
      ] as const) {
        acceptReferralEffect = Effect.fail(new ReferralError({ reason }));
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

  test("renders the support state without a Reservations section for ambiguous, unusable, claimed, and unverified outcomes that authored nothing", async () => {
    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "link-required",
      linkReason: "ambiguous",
    });
    await expect(loadPageState()).resolves.toEqual({
      kind: "support-required",
      deletion: "offered",
      assistants: [],
      email: customerEmail,
    });

    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "link-required",
      linkReason: "unusable",
    });
    await expect(loadPageState()).resolves.toEqual({
      kind: "support-required",
      deletion: "offered",
      assistants: [],
      email: customerEmail,
    });

    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "link-required",
      linkReason: "claimed",
    });
    await expect(loadPageState()).resolves.toEqual({
      kind: "support-required",
      deletion: "offered",
      assistants: [],
      email: customerEmail,
    });

    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "unverified-email",
    });
    await expect(loadPageState()).resolves.toEqual({
      kind: "support-required",
      deletion: "offered",
      assistants: [],
      email: customerEmail,
    });
  });

  test("shows the reservations an account authored while support resolves its profile", async () => {
    const authored = {
      id: "workspace-reservation-1",
      party: { kind: "booked-for", customerName: "Karla Ukázková" },
    };
    historyEffect = Effect.succeed({
      kind: "available",
      groups: { current: [authored], past: [], unavailable: [] },
    });

    for (const linkReason of ["ambiguous", "unusable", "claimed"]) {
      resolveEffect = resolverOutcome({
        kind: "failure",
        reason: "link-required",
        linkReason,
      });
      await expect(loadPageState()).resolves.toEqual({
        kind: "support-required",
        deletion: "offered",
        assistants: [],
        email: customerEmail,
        history: {
          kind: "available",
          groups: { current: [authored], past: [], unavailable: [] },
        },
      });
    }
    expect(historyLoadAccounts).toEqual([
      { accountId },
      { accountId },
      { accountId },
    ]);
  });

  test("keeps an unreadable authored history as a notice on the support state", async () => {
    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "link-required",
      linkReason: "claimed",
    });
    historyEffect = Effect.fail(new Error("dotypos down"));

    await expect(loadPageState()).resolves.toEqual({
      kind: "support-required",
      deletion: "offered",
      assistants: [],
      email: customerEmail,
      history: { kind: "unavailable", reason: "provider-unavailable" },
    });
  });

  test("reads no reservations for an unverified or deletion-requested support state", async () => {
    historyEffect = Effect.succeed({
      kind: "available",
      groups: {
        current: [{ id: "workspace-reservation-1" }],
        past: [],
        unavailable: [],
      },
    });

    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "unverified-email",
    });
    await expect(loadPageState()).resolves.toEqual({
      kind: "support-required",
      deletion: "offered",
      assistants: [],
      email: customerEmail,
    });

    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "link-required",
      linkReason: "deletion-requested",
    });
    await expect(loadPageState()).resolves.toEqual({
      kind: "support-required",
      deletion: "offered",
      assistants: [],
      email: customerEmail,
    });
    expect(historyLoadCalls).toBe(0);
  });

  test("offers no deletion without a profile when the review marker can't be read", async () => {
    reviewAccountEffect = Effect.fail(new Error("database unavailable"));
    resolveEffect = resolverOutcome({ kind: "failure", reason: "unavailable" });

    await expect(loadPageState()).resolves.toEqual({
      kind: "authenticated-unavailable",
      assistants: [],
      email: customerEmail,
      deletion: "withheld",
    });

    for (const [linkReason, kind] of [
      ["not-found", "completion-required"],
      ["ambiguous", "support-required"],
    ] as const) {
      resolveEffect = resolverOutcome({
        kind: "failure",
        reason: "link-required",
        linkReason,
      });
      await expect(loadPageState()).resolves.toMatchObject({
        kind,
        deletion: "withheld",
      });
    }
  });

  test("keeps deletion for a linked account or a pending deletion when the review marker can't be read", async () => {
    reviewAccountEffect = Effect.fail(new Error("database unavailable"));

    await expect(loadPageState()).resolves.toMatchObject({
      kind: "linked",
      deletion: "offered",
    });

    currentUserEffect = Effect.succeed({
      ...activeSession,
      deletionRequested: true,
    });
    await expect(loadPageState()).resolves.toEqual({
      kind: "deletion-pending",
      email: customerEmail,
      deletion: "pending",
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
      deletion: "pending",
    });
  });

  test("renders the linked account with profile and grouped history", async () => {
    await expect(loadPageState()).resolves.toEqual({
      kind: "linked",
      deletion: "offered",
      assistants: [],
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
    avatarsFlag.mockResolvedValue(false);

    await expect(loadPageState()).resolves.toEqual({
      kind: "linked",
      deletion: "offered",
      assistants: [],
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
    avatarsFlag.mockRejectedValue(new Error("flag unavailable"));

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

    passkeysFlag.mockResolvedValue(true);
    await expect(loadPageState()).resolves.toMatchObject({
      kind: "linked",
      passkeys: { accountId, passkeys: [accountPasskey] },
    });
    expect(passkeyListCalls).toBe(1);
  });

  test("keeps the linked page with an unavailable passkey list", async () => {
    passkeysFlag.mockResolvedValue(true);
    passkeyListEffect = Effect.fail(new Error("passkeys down"));

    await expect(loadPageState()).resolves.toMatchObject({
      kind: "linked",
      profile: { firstName: "Ada" },
      passkeys: { accountId, passkeys: null },
    });
  });

  test("fails closed without listing passkeys when the flag is unavailable", async () => {
    passkeysFlag.mockRejectedValue(new Error("flag unavailable"));

    await expect(loadPageState()).resolves.not.toHaveProperty("passkeys");
    expect(passkeyListCalls).toBe(0);
  });

  test("lists passkeys from the session in every signed-in state without a usable profile", async () => {
    passkeysFlag.mockResolvedValue(true);
    const passkeys = { accountId, passkeys: [accountPasskey] };
    profileLoadEffect = Effect.fail(new Error("profile gone"));
    await expect(loadPageState()).resolves.toEqual({
      kind: "authenticated-unavailable",
      deletion: "offered",
      assistants: [],
      email: customerEmail,
      passkeys,
    });

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
      deletion: "offered",
      assistants: [],
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
      deletion: "pending",
      email: customerEmail,
      passkeys,
    });
    expect(resolverCalls).toBe(resolutionsBeforeDeletion);
    expect(passkeyListCalls).toBe(4);
  });

  test("lists connected assistants in every signed-in state except a pending deletion", async () => {
    const assistant: CustomerAgentConnection = {
      id: "consent-synthetic",
      name: "Synthetic Assistant",
      host: "assistant.invalid",
      scopes: ["reservations:read"],
      administration: false,
      connectedAt: "2026-10-01T08:00:00.000Z",
    };
    assistantListEffect = Effect.succeed([assistant]);

    await expect(loadPageState()).resolves.toMatchObject({
      kind: "linked",
      assistants: [assistant],
    });

    profileLoadEffect = Effect.fail(new Error("profile gone"));
    await expect(loadPageState()).resolves.toEqual({
      kind: "authenticated-unavailable",
      deletion: "offered",
      email: customerEmail,
      assistants: [assistant],
    });

    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "link-required",
      linkReason: "not-found",
    });
    await expect(loadPageState()).resolves.toMatchObject({
      kind: "completion-required",
      assistants: [assistant],
    });

    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "link-required",
      linkReason: "ambiguous",
    });
    await expect(loadPageState()).resolves.toEqual({
      kind: "support-required",
      deletion: "offered",
      email: customerEmail,
      assistants: [assistant],
    });
    expect(assistantListCalls).toBe(4);

    // A pending deletion's grants no longer authorize, and deleting the
    // account removes them.
    currentUserEffect = Effect.succeed({
      ...activeSession,
      deletionRequested: true,
    });
    await expect(loadPageState()).resolves.toEqual({
      kind: "deletion-pending",
      email: customerEmail,
      deletion: "pending",
    });
    expect(assistantListCalls).toBe(4);
  });

  test("keeps the page with an unavailable assistant list", async () => {
    assistantListEffect = Effect.fail(new Error("consents down"));

    await expect(loadPageState()).resolves.toMatchObject({
      kind: "linked",
      profile: { firstName: "Ada" },
      assistants: null,
    });
  });

  test("lists no passkeys once resolution finds no session", async () => {
    passkeysFlag.mockResolvedValue(true);
    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "unauthenticated",
    });

    await expect(loadPageState()).resolves.toEqual({
      kind: "unauthenticated",
    });
    expect(passkeyListCalls).toBe(0);
    expect(assistantListCalls).toBe(0);
  });

  test("renders the authenticated unavailable state when the profile read fails after a successful link", async () => {
    profileLoadEffect = Effect.fail(new Error("profile gone"));

    await expect(loadPageState()).resolves.toEqual({
      kind: "authenticated-unavailable",
      deletion: "offered",
      assistants: [],
      email: customerEmail,
    });
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
      referralsFlag.mockResolvedValue(false);
      resolveEffect = resolverOutcome({
        kind: "failure",
        reason: "link-required",
        linkReason: "not-found",
      });

      await expect(loadPageState("RFL12345")).resolves.toEqual({
        kind: "completion-required",
        deletion: "offered",
        assistants: [],
        referralsEnabled: false,
        email: customerEmail,
      });
      expectNoReferralWork();
    });

    test("skips the auto-link acceptance, signup retry, settlement check, and summary", async () => {
      referralsFlag.mockResolvedValue(false);
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
        deletion: "offered",
        assistants: [],
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
      expect(referralsFlag).toHaveBeenCalledTimes(1);
    });
  });
  describe("when a section's capabilities can't be built", () => {
    /** A section layer whose construction fails, as on broken configuration. */
    const unbuildable = () =>
      Layer.effectDiscard(
        Effect.fail(new Error("configuration broken"))
      ) as never;

    /** A section layer whose server module can't load. */
    const unloadable = () =>
      Layer.effectDiscard(
        Effect.die(new Error("module failed to load"))
      ) as never;

    const loadWithWarnings = async (remembered?: string) => {
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
        return { state: await loadPageState(remembered), output: lines };
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
    };

    const warnings = (output: readonly string[]) =>
      output.filter((line) => line.includes("WARN")).join("\n");

    test("degrades only the avatar when its media capability can't be built", async () => {
      layerOverrides = { avatar: unbuildable() };

      const { state, output } = await loadWithWarnings();

      expect(state).toEqual({
        kind: "linked",
        deletion: "offered",
        assistants: [],
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
      expect(warnings(output)).toContain("account.avatar.unavailable");
      expect(output.join("\n")).not.toContain("configuration broken");
    });

    test("ignores a capability that can't be built while the page skips its section", async () => {
      layerOverrides = { avatar: unbuildable() };
      avatarsFlag.mockResolvedValue(false);

      const { state, output } = await loadWithWarnings();

      expect(state).toMatchObject({
        kind: "linked",
        avatar: { kind: "hidden" },
      });
      expect(warnings(output)).not.toContain("account.avatar.unavailable");
    });

    test("degrades only the history when its capability can't be built", async () => {
      layerOverrides = { history: unbuildable() };

      const { state, output } = await loadWithWarnings();

      expect(state).toMatchObject({
        kind: "linked",
        avatar: { kind: "available", avatar: null },
        history: { kind: "unavailable", reason: "provider-unavailable" },
        referrals: accountReferrals,
      });
      expect(warnings(output)).toContain(
        "account.reservation-history.unavailable"
      );
      expect(output.join("\n")).not.toContain("configuration broken");
    });

    test("degrades a review account's history alone when its capability can't be built", async () => {
      reviewAccountEffect = Effect.succeed(true);
      layerOverrides = { history: unbuildable() };

      await expect(loadPageState()).resolves.toEqual({
        kind: "review-account",
        deletion: "withheld",
        assistants: [],
        email: customerEmail,
        history: { kind: "unavailable", reason: "provider-unavailable" },
      });
    });

    test("keeps the session's sections when the profile capability can't be built", async () => {
      passkeysFlag.mockResolvedValue(true);
      layerOverrides = { profile: unbuildable() };

      const { state, output } = await loadWithWarnings();

      expect(state).toEqual({
        kind: "authenticated-unavailable",
        deletion: "offered",
        assistants: [],
        email: customerEmail,
        passkeys: { accountId, passkeys: [accountPasskey] },
      });
      expect(output.join("\n")).toContain("Account profile load failed");
    });

    test("keeps the session's sections when the resolver can't be built", async () => {
      layerOverrides = { resolver: unbuildable() };

      const { state, output } = await loadWithWarnings("RFL12345");

      expect(state).toEqual({
        kind: "authenticated-unavailable",
        deletion: "offered",
        assistants: [],
        email: customerEmail,
      });
      const logged = output.join("\n");
      expect(logged).toContain("Account resolution failed");
      expect(logged).toContain("account-link.lock");
      expect(logged).not.toContain("configuration broken");
      expect(profileLoadCalls).toBe(0);
    });

    test("keeps the linked page without referral state when the referral capability can't be built", async () => {
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
      layerOverrides = { referrals: unbuildable() };

      const { state, output } = await loadWithWarnings("RFL12345");

      expect(state).toEqual({
        kind: "linked",
        deletion: "offered",
        assistants: [],
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
      });
      const logged = warnings(output);
      for (const code of [
        "account.auto-link.referral.unavailable",
        "account.signup-referral.unavailable",
        "referrals.remembered-referral.unavailable",
        "account.referrals.unavailable",
      ]) {
        expect(logged).toContain(code);
      }
      expect(output.join("\n")).not.toContain("configuration broken");
      expect(acceptReferralCalls).toEqual([]);
      expect(storedSignupIntent).toMatchObject({ code: "RFLPENDING" });
      expect(storedSignupIntent).not.toHaveProperty("outcome");
    });

    test("offers profile completion without a prefill when the referral capability can't be built", async () => {
      resolveEffect = resolverOutcome({
        kind: "failure",
        reason: "link-required",
        linkReason: "not-found",
      });
      layerOverrides = { referrals: unbuildable() };

      const { state, output } = await loadWithWarnings("RFL12345");

      expect(state).toEqual({
        kind: "completion-required",
        deletion: "offered",
        assistants: [],
        email: customerEmail,
        referralsEnabled: true,
      });
      expect(warnings(output)).toContain("account.referral-code.unavailable");
      expect(availableReferralCodeCalls).toEqual([]);
    });
    test("fails every account flag closed when the flag capability can't load", async () => {
      passkeysFlag.mockResolvedValue(true);
      layerOverrides = { featureFlags: unloadable() };

      await expect(loadPageState()).resolves.toMatchObject({
        kind: "linked",
        avatar: { kind: "hidden" },
      });
      expect(passkeyListCalls).toBe(0);
      expect(avatarLookupCalls).toBe(0);
    });

    test("fails a flag closed when its evaluation dies", async () => {
      passkeysFlag.mockResolvedValue(true);
      layerOverrides = {
        featureFlags: Layer.mock(AccountFeatureFlagService, {
          isPasskeyEnabled: Effect.die(new Error("evaluation crashed")),
          isAvatarEnabled: Effect.die(new Error("evaluation crashed")),
        }),
      };

      const state = await loadPageState();

      expect(state).toMatchObject({
        kind: "linked",
        avatar: { kind: "hidden" },
      });
      expect(state).not.toHaveProperty("passkeys");
    });

    test("keeps a pending deletion whole when the assistants capability can't load", async () => {
      currentUserEffect = Effect.succeed({
        ...activeSession,
        deletionRequested: true,
      });
      layerOverrides = { assistants: unloadable() };

      await expect(loadPageState()).resolves.toEqual({
        kind: "deletion-pending",
        deletion: "pending",
        email: customerEmail,
      });
    });
    test("degrades only the sections whose capabilities die while building", async () => {
      layerOverrides = { avatar: unloadable(), history: unloadable() };

      const { state, output } = await loadWithWarnings();

      expect(state).toMatchObject({
        kind: "linked",
        profile: { firstName: "Ada" },
        avatar: { kind: "available", avatar: null },
        history: { kind: "unavailable", reason: "provider-unavailable" },
        referrals: accountReferrals,
      });
      const logged = warnings(output);
      expect(logged).toContain("account.avatar.unavailable");
      expect(logged).toContain("account.reservation-history.unavailable");
      expect(output.join("\n")).not.toContain("module failed to load");
    });

    test("degrades a section whose read dies", async () => {
      historyEffect = Effect.die(new Error("history crashed"));

      const { state, output } = await loadWithWarnings();

      expect(state).toMatchObject({
        kind: "linked",
        history: { kind: "unavailable", reason: "provider-unavailable" },
      });
      expect(warnings(output)).toContain(
        "account.reservation-history.unavailable"
      );
      expect(output.join("\n")).not.toContain("history crashed");
    });

    test("keeps the session's sections when the profile capability dies while building", async () => {
      layerOverrides = { profile: unloadable() };

      await expect(loadPageState()).resolves.toEqual({
        kind: "authenticated-unavailable",
        deletion: "offered",
        assistants: [],
        email: customerEmail,
      });
    });
    test("degrades the signup referral before reading a settled outcome when the referral capability can't be built", async () => {
      storedSignupIntent = {
        code: "RFLPENDING",
        promotionCodeId: "@test/promotion-code-id",
        referrerDotyposCustomerId: "70001",
        outcome: "applied",
      };
      layerOverrides = { referrals: unbuildable() };

      const { state, output } = await loadWithWarnings();

      expect(state).toMatchObject({ kind: "linked" });
      expect(state).not.toHaveProperty("signupReferral");
      expect(warnings(output)).toContain("account.signup-referral.unavailable");
    });

    test("logs the auto-link acceptance as unavailable without an auto-link when the referral capability can't be built", async () => {
      layerOverrides = { referrals: unbuildable() };

      const { state, output } = await loadWithWarnings();

      expect(state).toMatchObject({ kind: "linked" });
      expect(warnings(output)).toContain(
        "account.auto-link.referral.unavailable"
      );
    });

    test("lets Next.js control flow from a section reach Next.js", async () => {
      historyEffect = Effect.sync(() => redirect("/target"));

      await expect(loadPageState()).rejects.toThrow("NEXT_REDIRECT");
    });
    describe("with Next.js control flow beside a typed failure", () => {
      const redirectError = Effect.runSync(
        Effect.flip(
          Effect.try({
            try: () => redirect("/target"),
            catch: (thrown) => thrown,
          })
        )
      );
      const composite = Cause.combine(
        Cause.fail(new Error("broken")),
        Cause.die(redirectError)
      );
      const loadExit = () =>
        Effect.runPromiseExit(
          loadAccountPageState.pipe(Effect.provide(pageLayer()))
        );

      test("keeps the control flow of a section read", async () => {
        historyEffect = Effect.failCause(composite);

        const exit = await loadExit();

        expect(exit._tag === "Failure" && findNextControlFlow(exit.cause)).toBe(
          redirectError
        );
      });

      test("keeps the control flow of a capability that failed to build", async () => {
        layerOverrides = {
          history: Layer.effectDiscard(Effect.failCause(composite)) as never,
        };

        const exit = await loadExit();

        expect(exit._tag === "Failure" && findNextControlFlow(exit.cause)).toBe(
          redirectError
        );
      });

      test("keeps the control flow of the resolution", async () => {
        resolveEffect = Effect.failCause(composite) as never;

        const exit = await loadExit();

        expect(exit._tag === "Failure" && findNextControlFlow(exit.cause)).toBe(
          redirectError
        );
      });
    });
  });
});
