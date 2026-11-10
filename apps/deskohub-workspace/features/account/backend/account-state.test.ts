import type { DotyposCustomerId } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Effect, Layer, Predicate } from "effect";
import {
  AccountAvatarReleaseGate,
  PasskeyReleaseGate,
} from "@/features/account/backend/account-release-gates";
import { CustomerAgentConnections } from "@/features/account/backend/auth/customer-agent-connections.service";
import { CustomerPasskeys } from "@/features/account/backend/auth/customer-passkeys.service";
import { CurrentCustomerAccount } from "@/features/account/backend/current-customer-account";
import { CustomerAccountContactService } from "@/features/account/backend/customer-account-contact.service";
import {
  type CustomerAccountSession,
  CustomerAuthentication,
} from "@/features/account/backend/customer-authentication.service";
import { testSessionProfile } from "@/features/account/backend/customer-authentication.test-utils";
import { CustomerAvatarService } from "@/features/account/backend/customer-avatar.service";
import { CustomerProfileService } from "@/features/account/backend/customer-profile.service";
import {
  CustomerAccountAccessError,
  type CustomerAccountId,
} from "@/features/account/customer-account";
import { releaseGateForRun } from "@/features/feature-flags/backend/release-gate-run";
import { ReferralServiceMock } from "@/features/referrals/referral.service.mock";
import {
  ReferralReleaseGate,
  referralReleaseRunPolicy,
} from "@/features/referrals/referral-release-gate";
import { RememberedReferral } from "@/features/referrals/remembered-referral.service";
import { ReferralSignupIntentRepository } from "@/features/referrals/signup-intent.repository";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import { ReviewAccountsMock } from "@/features/review-accounts/backend/review-accounts.repository.mock";
import { loadAccountState } from "./account-state";
import {
  type AccountStateLayers,
  accountStateCapabilities,
} from "./account-state-capabilities";

const email = testEmailAddress("ada");
const accountId = "auth-account-1" as CustomerAccountId;
const linkedCustomer = "60111";

const session = {
  accountId,
  email: reservationCustomerEmailSchema.make(email),
  deletionRequested: false,
  ...testSessionProfile,
} satisfies CustomerAccountSession;

type ResolvedStanding = Effect.Success<
  CurrentCustomerAccount["Service"]["resolve"]
>;

/** The account's standing for `account`'s session, with no review marker. */
const signedIn = <Kind extends "profile-missing" | "deletion-pending">(
  kind: Kind,
  account: CustomerAccountSession = session
) =>
  Effect.succeed({ kind, session: account, reviewMarker: "absent" as const });

const linked = (
  autoLinked: boolean,
  account: CustomerAccountSession = session
) =>
  Effect.succeed({
    kind: "linked" as const,
    session: account,
    reviewMarker: "absent" as const,
    account: {
      accountId,
      dotyposCustomerId: linkedCustomer as DotyposCustomerId,
    },
    autoLinked,
  });

let currentStanding: Effect.Effect<ResolvedStanding, unknown>;
let profile: Effect.Effect<unknown, unknown>;
let avatar: Effect.Effect<unknown, unknown>;
let referralSummary: Effect.Effect<unknown, unknown>;
let settled: boolean;
let clientReferralCode: string | undefined;
let calls: string[];
let layerOverrides: Partial<AccountStateLayers>;

const summary = {
  code: "RFL12345",
  inviteeCount: 0,
  eligibleInviteeCount: 0,
  discount: "0",
  savings: [],
} as const;

const record =
  (call: string) =>
  <A, E>(effect: Effect.Effect<A, E>) =>
    Effect.suspend(() => {
      calls.push(call);
      return effect;
    });

/**
 * The account state's capabilities over fakes, with the referral code a
 * client sent and the release decisions a request made.
 */
const capabilities = () =>
  accountStateCapabilities({
    authentication: Layer.mock(CustomerAuthentication, {
      currentUser: Effect.succeed(session),
    }),
    currentAccount: Layer.mock(CurrentCustomerAccount, {
      resolve: Effect.suspend(() => currentStanding) as never,
    }),
    profile: Layer.mock(CustomerProfileService, {
      load: () => profile as never,
    }),
    avatar: Layer.mock(CustomerAvatarService, {
      lookup: () => avatar as never,
    }),
    passkeys: Layer.mock(CustomerPasskeys, {
      list: record("passkeys")(Effect.succeed([])) as never,
    }),
    assistants: Layer.mock(CustomerAgentConnections, {
      list: record("assistants")(Effect.succeed([])),
    }),
    reviewAccounts: ReviewAccountsMock({
      isReviewAccount: () => Effect.succeed(false),
    }),
    referrals: ReferralServiceMock({
      getAccountSummary: () => record("summary")(referralSummary) as never,
      acceptReferral: ({ code }) =>
        record(`accept ${code}`)(
          Effect.succeed({ status: "accepted" })
        ) as never,
      findAvailableCode: ({ code }) =>
        record(`find ${code}`)(Effect.succeed(code)) as never,
      hasSettledReferral: () =>
        record("settled")(Effect.sync(() => settled)) as never,
    }),
    signupIntents: Layer.mock(ReferralSignupIntentRepository, {
      find: () => Effect.succeed(undefined) as never,
    }),
    referralRelease: ReferralReleaseGate.fromDecision(true),
    rememberedReferral: Layer.suspend(() =>
      RememberedReferral.fromClient(clientReferralCode)
    ).pipe(Layer.provide(Layer.mock(CustomerAccountContactService, {}))),
    passkeyRelease: PasskeyReleaseGate.fromDecision(true),
    avatarRelease: AccountAvatarReleaseGate.fromDecision(true),
    ...layerOverrides,
  });

const load = () =>
  Effect.runPromise(loadAccountState.pipe(Effect.provide(capabilities())));

/** Loads the state, capturing the warnings it logs. */
const loadWithWarnings = async () => {
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
    const state = await load();
    return {
      state,
      warnings: lines.filter((line) => line.includes("WARN")).join("\n"),
      output: lines.join("\n"),
    };
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
};

const linkedProfile = {
  firstName: "Ada",
  lastName: "Lovelace",
  phone: null,
  billing: null,
};

beforeEach(() => {
  currentStanding = linked(false);
  profile = Effect.succeed(linkedProfile);
  avatar = Effect.succeed(null);
  referralSummary = Effect.succeed(summary);
  settled = false;
  clientReferralCode = undefined;
  calls = [];
  layerOverrides = {};
});

describe("loadAccountState", () => {
  test("loads the linked account without reading reservation history", async () => {
    const state = await load();

    expect(state).toEqual({
      kind: "linked",
      email,
      deletion: "offered",
      passkeys: { accountId, passkeys: [] },
      assistants: [],
      profile: linkedProfile,
      avatar: { kind: "available", avatar: null },
      referralsEnabled: true,
      referrals: {
        summary,
        shareUrl: expect.stringContaining(summary.code),
      },
    });
    expect(state).not.toHaveProperty("history");
  });

  test("offers completion with the client's usable referral code, without history", async () => {
    currentStanding = signedIn("profile-missing");
    clientReferralCode = " rfl12345 ";

    const state = await load();

    expect(state).toEqual({
      kind: "completion-required",
      email,
      deletion: "offered",
      passkeys: { accountId, passkeys: [] },
      assistants: [],
      referralsEnabled: true,
      referralCode: "RFL12345",
    });
    expect(calls).toContain("find RFL12345");
  });

  test("loads a review account and a support state without history", async () => {
    currentStanding = Effect.succeed({ kind: "review", session });
    await expect(load()).resolves.toEqual({
      kind: "review-account",
      email,
      deletion: "withheld",
      assistants: [],
    });

    currentStanding = Effect.succeed({
      kind: "support-required",
      reason: "ambiguous",
      session,
      reviewMarker: "absent",
    });
    const state = await load();
    expect(state.kind).toBe("support-required");
    expect(state).not.toHaveProperty("history");
  });

  test("carries the session's saved locale preference in every signed-in state", async () => {
    const withLocale = {
      ...session,
      localePreference: "de-DE",
    } satisfies CustomerAccountSession;
    currentStanding = linked(false, withLocale);
    await expect(load()).resolves.toMatchObject({
      kind: "linked",
      localePreference: "de-DE",
    });

    currentStanding = signedIn("deletion-pending", {
      ...withLocale,
      deletionRequested: true,
    });
    await expect(load()).resolves.toMatchObject({
      kind: "deletion-pending",
      localePreference: "de-DE",
    });
  });

  test("is unavailable when the session can't be read, and unauthenticated without one", async () => {
    currentStanding = Effect.fail(
      new CustomerAccountAccessError({ reason: "unavailable" })
    );
    expect((await loadWithWarnings()).state).toEqual({ kind: "unavailable" });

    currentStanding = Effect.succeed({ kind: "signed-out" });
    await expect(load()).resolves.toEqual({ kind: "unauthenticated" });
    expect(calls).toEqual([]);
  });

  test("keeps the session's sections when the profile can't be read", async () => {
    profile = Effect.fail(new Error("dotypos down"));

    const { state } = await loadWithWarnings();

    expect(state).toEqual({
      kind: "authenticated-unavailable",
      email,
      deletion: "offered",
      passkeys: { accountId, passkeys: [] },
      assistants: [],
    });
  });

  test("degrades the avatar and referral sections with fixed, cause-free warnings", async () => {
    avatar = Effect.fail(new Error("private media detail"));
    referralSummary = Effect.die(new Error("private referral detail"));

    const { state, warnings, output } = await loadWithWarnings();

    expect(state).toMatchObject({
      kind: "linked",
      avatar: { kind: "available", avatar: null },
      referralsEnabled: true,
    });
    expect(state).toMatchObject({ referrals: undefined });
    expect(warnings).toContain("account.avatar.unavailable");
    expect(warnings).toContain("account.referrals.unavailable");
    expect(output).not.toContain("private media detail");
    expect(output).not.toContain("private referral detail");
  });

  test("degrades only the sections whose capabilities can't be built", async () => {
    layerOverrides = {
      avatar: Layer.effectDiscard(
        Effect.fail(new Error("configuration broken"))
      ) as never,
      passkeys: Layer.effectDiscard(
        Effect.die(new Error("module failed to load"))
      ) as never,
    };

    const { state, warnings } = await loadWithWarnings();

    expect(state).toMatchObject({
      kind: "linked",
      profile: linkedProfile,
      avatar: { kind: "available", avatar: null },
      passkeys: { accountId, passkeys: null },
    });
    expect(warnings).toContain("account.avatar.unavailable");
    expect(warnings).toContain("account.passkeys.unavailable");
  });

  test("records the client's referral code when this load auto-linked an existing customer", async () => {
    currentStanding = linked(true);
    clientReferralCode = "RFL12345";
    settled = true;

    const state = await load();

    expect(calls).toEqual([
      "accept RFL12345",
      "settled",
      "summary",
      "passkeys",
      "assistants",
    ]);
    // The client forgets its code; this load writes nothing for it.
    expect(state).toMatchObject({
      kind: "linked",
      rememberedReferralCodeUsed: true,
    });
  });

  test("withholds every referral read and write when the gate's run fails", async () => {
    currentStanding = linked(true);
    clientReferralCode = "RFL12345";
    layerOverrides = {
      referralRelease: releaseGateForRun(
        {
          isOpen: ReferralReleaseGate.isOpen,
          fromDecision: ReferralReleaseGate.fromDecision,
          fromEvaluation: ReferralReleaseGate.fromEvaluation,
          Live: ReferralReleaseGate.fromEvaluation(
            Effect.die(new Error("flag runtime broke"))
          ),
        },
        referralReleaseRunPolicy
      ),
    };

    const { state, warnings } = await loadWithWarnings();

    expect(state).toMatchObject({ kind: "linked", referralsEnabled: false });
    expect(state).toMatchObject({ referrals: undefined });
    expect(calls).toEqual(["passkeys", "assistants"]);
    expect(warnings).toContain(referralReleaseRunPolicy.failureCode);
  });
});
