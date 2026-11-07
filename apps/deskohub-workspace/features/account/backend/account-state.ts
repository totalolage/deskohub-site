import { Cause, Effect, Result } from "effect";
import type { LazyArg } from "effect/Function";
import {
  AccountAvatarReleaseGate,
  PasskeyReleaseGate,
} from "@/features/account/backend/account-release-gates";
import {
  type AccountStateCapabilities,
  replayBuildFailure,
} from "@/features/account/backend/account-state-capabilities";
import { CustomerAgentConnections } from "@/features/account/backend/auth/customer-agent-connections.service";
import { CustomerPasskeys } from "@/features/account/backend/auth/customer-passkeys.service";
import { acceptAutoLinkedReferral } from "@/features/account/backend/auto-linked-referral";
import { accountReferralOverview } from "@/features/account/backend/current-referral-overview";
import { CustomerAccountResolver } from "@/features/account/backend/customer-account-resolver.service";
import {
  type CustomerAccountSession,
  CustomerAuthentication,
} from "@/features/account/backend/customer-authentication.service";
import { CustomerAvatarService } from "@/features/account/backend/customer-avatar.service";
import { CustomerProfileService } from "@/features/account/backend/customer-profile.service";
import {
  CustomerReservationHistoryService,
  type ReservationHistoryAccount,
} from "@/features/account/backend/customer-reservation-history.service";
import { recordSignupReferral } from "@/features/account/backend/signup-referral";
import type {
  AccountDeletion,
  CustomerAvatarPresentation,
  CustomerProfile,
  CustomerReservationHistory,
  ProfileCompletionReferralOutcome,
} from "@/features/account/contracts";
import {
  type CustomerAccountAccessError,
  type CustomerAccountId,
  customerAccountUnavailable,
  isCustomerAccountSupportRequired,
  isCustomerProfileMissing,
  type LinkedCustomerAccount,
} from "@/features/account/customer-account";
import type { CustomerAgentConnection } from "@/features/account/customer-agent-connections";
import type { AccountPasskeySettings } from "@/features/account/passkeys";
import { ReferralService } from "@/features/referrals";
import type { ReferralCode } from "@/features/referrals/client";
import type { ReferralAccountOverview } from "@/features/referrals/contracts";
import { ReferralReleaseGate } from "@/features/referrals/referral-release-gate";
import { RememberedReferral } from "@/features/referrals/remembered-referral.service";
import { ReviewAccounts } from "@/features/review-accounts";
import {
  catchRecoverableCause,
  failuresAsDefects,
  isRecoverableCause,
} from "@/shared/backend/workspace-effect";

/**
 * Sign-in methods and connected assistants need only the session, so every
 * signed-in state carries them, whether or not the Dotypos profile is
 * available.
 */
type SessionSettings = {
  /** Whether deletion is offered; a linked account always offers it. */
  readonly deletion: AccountDeletion;
  /** The account's passkeys; absent while `login_passkeys` is off. */
  readonly passkeys?: AccountPasskeySettings;
  /**
   * The AI assistants the customer connected, null when they couldn't be
   * read. Absent while deletion is pending: those grants no longer
   * authorize, and deleting the account removes them.
   */
  readonly assistants?: readonly CustomerAgentConnection[] | null;
};

/**
 * The closed set of signed-in customer account states, without reservation
 * history. Every state is derived from the authoritative Better Auth session
 * and the Dotypos link, never from the proxy or cookies.
 */
export type CustomerAccountState =
  | { readonly kind: "unavailable" }
  | { readonly kind: "unauthenticated" }
  | SignedInAccountState;

type SignedInAccountState = SessionSettings & SignedInAccountContent;

type SignedInAccountContent =
  | { readonly kind: "authenticated-unavailable"; readonly email: string }
  | {
      readonly kind: "completion-required";
      readonly email: string;
      /** Whether the referral program is released and offers a code field. */
      readonly referralsEnabled: boolean;
      /** Invitation code to prefill, present only when currently usable. */
      readonly referralCode?: ReferralCode;
    }
  | {
      readonly kind: "linked";
      readonly email: string;
      readonly profile: CustomerProfile;
      readonly avatar: CustomerAvatarPresentation;
      /** Whether the referral program is released and has a section. */
      readonly referralsEnabled: boolean;
      readonly referrals?: ReferralAccountOverview;
      /**
       * Outcome of the code a profile completion could not record at once:
       * the retry's result, then the stored outcome on every load until the
       * customer acknowledges it (`recordSignupReferral`).
       */
      readonly signupReferral?: ProfileCompletionReferralOutcome;
      /**
       * Present when the remembered referral code is one the customer's
       * settled referral has made moot, so the client forgets it.
       */
      readonly rememberedReferralCodeUsed?: true;
    }
  | { readonly kind: "support-required"; readonly email: string }
  /**
   * An app-directory review account: no profile, and a history of sample
   * reservations and simulated holds.
   */
  | { readonly kind: "review-account"; readonly email: string }
  | { readonly kind: "deletion-pending"; readonly email: string };

/**
 * An account state with the reservation history it shows: always for a
 * linked or review account, and for an account without a usable profile
 * only when it authored reservations or they can't be read.
 */
export type CustomerAccountStateWithHistory =
  WithReservationHistory<CustomerAccountState>;

type WithReservationHistory<State> = State extends {
  readonly kind: "linked" | "review-account";
}
  ? State & { readonly history: CustomerReservationHistory }
  : State extends { readonly kind: "completion-required" | "support-required" }
    ? State & { readonly history?: CustomerReservationHistory }
    : State;

/**
 * A loaded state with the reservations it shows: a linked or review account
 * always shows its own history; an account without a usable profile may show
 * what it authored for others, only when it has any or they can't be read.
 */
type WithHistoryScope<State> = State extends {
  readonly kind: "linked" | "review-account";
}
  ? {
      readonly state: State;
      readonly shown: "always";
      readonly history: ReservationHistoryAccount;
    }
  : State extends { readonly kind: "completion-required" | "support-required" }
    ? { readonly state: State } & (
        | {
            readonly shown: "when-any";
            readonly history: ReservationHistoryAccount;
          }
        | NoHistory
      )
    : { readonly state: State } & NoHistory;

type NoHistory = { readonly shown?: undefined; readonly history?: undefined };

type LoadedAccount = WithHistoryScope<CustomerAccountState>;

type LoadedContent = WithHistoryScope<
  SignedInAccountContent | { readonly kind: "unauthenticated" }
>;

/** The fixed, non-PII codes of the sections that degrade without blocking. */
type AccountSectionFailureCode =
  | "account.assistants.unavailable"
  | "account.auto-link.referral.unavailable"
  | "account.avatar.unavailable"
  | "account.passkeys.unavailable"
  | "account.referral-code.unavailable"
  | "account.referrals.unavailable"
  | "account.remembered-referral.unavailable"
  | "account.reservation-history.unavailable"
  | "account.review.unavailable"
  | "account.signup-referral.unavailable";

/**
 * Loads the signed-in customer's account state from its capabilities,
 * without reading reservation history. It never fails: an unreadable session
 * is the unavailable state, and every other section degrades on its own.
 * Every signed-in state, including one without a usable profile, also
 * carries its sign-in methods.
 *
 * Loading it is not read-only. While the referral program is released it
 * deliberately:
 * - resolves the session's Dotypos link, which may claim an existing
 *   customer for the account (auto-link), and then records the remembered
 *   referral code for that newly linked customer;
 * - retries, for a linked account, the referral code its profile completion
 *   could not record yet, reporting its outcome in `signupReferral` on every
 *   load until the customer acknowledges it.
 * Writes to the remembered code itself are left to the caller: the state
 * reports `rememberedReferralCodeUsed` so the client forgets it.
 */
export const loadAccountState: Effect.Effect<
  CustomerAccountState,
  never,
  AccountStateCapabilities
> = Effect.suspend(() => loadAccount).pipe(Effect.map(({ state }) => state));

/**
 * `loadAccountState` with the reservation history the state shows, read
 * after the state. An unavailable history degrades to the section's
 * unavailable notice.
 */
export const loadAccountStateWithHistory: Effect.Effect<
  CustomerAccountStateWithHistory,
  never,
  AccountStateCapabilities | CustomerReservationHistoryService
> = Effect.suspend(() => loadAccount).pipe(Effect.flatMap(attachHistory));

/** Reads the history `loaded` shows and attaches it to its state. */
function attachHistory(
  loaded: LoadedAccount
): Effect.Effect<
  CustomerAccountStateWithHistory,
  never,
  CustomerReservationHistoryService
> {
  switch (loaded.shown) {
    case undefined:
      return Effect.succeed(loaded.state);
    case "always":
      return loadReservationHistory(loaded.history).pipe(
        Effect.map((history) => ({ ...loaded.state, history }))
      );
    case "when-any":
      return loadReservationHistory(loaded.history).pipe(
        Effect.map((history) =>
          mayHaveReservations(history)
            ? { ...loaded.state, history }
            : loaded.state
        )
      );
  }
}

const loadAccount: Effect.Effect<
  LoadedAccount,
  never,
  AccountStateCapabilities
> = Effect.gen(function* () {
  const session = yield* Effect.flatMap(
    CustomerAuthentication,
    (authentication) => authentication.currentUser
  ).pipe(
    Effect.tapError((error) =>
      Effect.logError("Account authentication failed", { error })
    ),
    Effect.result,
    withOperation("account.profile")
  );
  if (Result.isFailure(session)) return { state: { kind: "unavailable" } };

  const user = session.success;
  if (!user) return { state: { kind: "unauthenticated" } };
  const reviewAccount = yield* readReviewAccount(user);
  const loaded: LoadedContent = user.deletionRequested
    ? { state: { kind: "deletion-pending", email: user.email } }
    : yield* loadSignedInAccount(user, reviewAccount);
  const content = loaded.state;
  if (content.kind === "unauthenticated") return { state: content };
  const { passkeys, assistants } = yield* Effect.all(
    {
      // A review account signs in with its password only.
      passkeys:
        reviewAccount === false
          ? loadPasskeySettings(user.accountId)
          : Effect.succeed(undefined),
      assistants:
        content.kind === "deletion-pending"
          ? Effect.void
          : loadCustomerAgentConnections,
    },
    { concurrency: "unbounded" }
  );
  return withSessionSettings(loaded, {
    deletion: accountDeletion(content, reviewAccount),
    ...(passkeys && { passkeys }),
    ...(assistants !== undefined && { assistants }),
  });
});

/**
 * Adds the session's settings to a signed-in state. They never change its
 * kind, so the history it shows stays the one its loader chose.
 */
const withSessionSettings = (
  loaded: LoadedContent,
  settings: SessionSettings
): LoadedAccount =>
  ({ ...loaded, state: { ...loaded.state, ...settings } }) as LoadedAccount;

/**
 * A review account can't be deleted, and an unreadable marker lands one in a
 * state without a profile. A linked account or a pending deletion has passed
 * checks that refuse a review account.
 */
const accountDeletion = (
  state: SignedInAccountContent,
  reviewAccount: boolean | undefined
): AccountDeletion => {
  if (state.kind === "deletion-pending") return "pending";
  if (state.kind === "linked") return "offered";
  if (state.kind === "review-account" || reviewAccount === undefined) {
    return "withheld";
  }
  return "offered";
};

/**
 * Scopes a step's logs to its own operation name under the caller's runtime
 * edge, which names the boundary.
 */
const withOperation = (operation: string) => Effect.annotateLogs({ operation });

/**
 * Reads an account release flag, which fails closed: a flag capability that
 * can't be built, or a defect while evaluating, counts as off.
 */
const accountFlag = <E, R>(flag: Effect.Effect<boolean, E, R>) =>
  flag.pipe(catchRecoverableCause(() => Effect.succeed(false)));

/**
 * Degrades a non-blocking section to `fallback` on any failure, including a
 * capability that couldn't be built, logging only its fixed code; the
 * provider or database cause is never attached.
 */
const degradable =
  <B>(code: AccountSectionFailureCode, fallback: LazyArg<B>) =>
  <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A | B, never, R> =>
    self.pipe(
      catchRecoverableCause(() =>
        logDegradedAccountSection(code).pipe(Effect.map(fallback))
      )
    );

/**
 * Whether the referral program is released: the request's one decision,
 * shared with every referral service of this load (and, on the site, the
 * account layout's navigation). An unavailable evaluation fails closed: a
 * withheld program reads, writes, and shows no referral state.
 */
const referralsReleased = ReferralReleaseGate.isOpen;

/**
 * The Sign-in & security section's passkeys while `login_passkeys` is on. An
 * unreadable flag counts as off; an unreadable list keeps the section with
 * an unavailable notice.
 */
const loadPasskeySettings = Effect.fn(function* (accountId: CustomerAccountId) {
  const passkeysEnabled = yield* accountFlag(PasskeyReleaseGate.isOpen).pipe(
    withOperation("account.passkeys-enabled")
  );
  if (!passkeysEnabled) return undefined;
  const passkeys = yield* Effect.flatMap(
    CustomerPasskeys,
    (service) => service.list
  ).pipe(
    degradable("account.passkeys.unavailable", () => null),
    withOperation("account.passkeys")
  );
  return { accountId, passkeys } satisfies AccountPasskeySettings;
});

/**
 * The Connected assistants section's list. An unreadable list keeps the
 * section with an unavailable notice.
 */
const loadCustomerAgentConnections = Effect.flatMap(
  CustomerAgentConnections,
  (connections) => connections.list
).pipe(
  degradable("account.assistants.unavailable", () => null),
  withOperation("account.assistants")
);

const loadLinkedAccount = Effect.fn(function* (
  user: { readonly email: string },
  account: LinkedCustomerAccount,
  referralsEnabled: boolean
) {
  const profile = yield* Effect.flatMap(CustomerProfileService, (service) =>
    service.load(account)
  ).pipe(
    catchRecoverableCause((cause) =>
      Effect.logError("Account profile load failed", {
        error: Cause.squash(cause),
      }).pipe(Effect.as(undefined))
    ),
    withOperation("account.profile.read")
  );
  if (profile === undefined) {
    return {
      state: {
        kind: "authenticated-unavailable",
        email: user.email,
      },
    } satisfies LoadedContent;
  }

  // Retries a profile-completion referral that is still waiting, outside any
  // account lock like the auto-link before it. It runs only once the linked
  // state is certain, so the load that settles the code is the one that
  // reports its outcome. A withheld program leaves the stored code as is.
  const signupReferral = referralsEnabled
    ? yield* replayBuildFailure(ReferralService).pipe(
        Effect.andThen(recordSignupReferral(account)),
        Effect.catchCause(() =>
          logDegradedAccountSection("account.signup-referral.unavailable").pipe(
            Effect.as(undefined)
          )
        ),
        withOperation("account.signup-referral")
      )
    : undefined;
  // Checked after both recording paths, so a code they just used is forgotten
  // on this load.
  const rememberedReferralCodeUsed = yield* Effect.flatMap(
    RememberedReferral,
    (remembered) =>
      remembered.isSettled({
        kind: "account",
        customerId: account.dotyposCustomerId,
      })
  ).pipe(
    degradable("account.remembered-referral.unavailable", () => false),
    withOperation("account.remembered-referral")
  );

  // An unavailable avatar capability evaluation fails closed to hidden.
  const avatarsEnabled = yield* accountFlag(
    AccountAvatarReleaseGate.isOpen
  ).pipe(withOperation("account.avatars-enabled"));
  let avatar: CustomerAvatarPresentation = { kind: "hidden" };
  if (avatarsEnabled) {
    // A media outage never blocks the account: an avatar read failure
    // degrades to the initials fallback.
    const availableAvatar = yield* Effect.flatMap(
      CustomerAvatarService,
      (service) => service.lookup(account.accountId)
    ).pipe(
      degradable("account.avatar.unavailable", () => null),
      withOperation("account.avatar")
    );
    avatar = { kind: "available", avatar: availableAvatar };
  }

  const referrals = referralsEnabled
    ? yield* loadReferralOverview(account)
    : undefined;

  return {
    state: {
      kind: "linked",
      email: user.email,
      profile,
      avatar,
      referralsEnabled,
      referrals,
      ...(signupReferral && { signupReferral }),
      ...(rememberedReferralCodeUsed && {
        rememberedReferralCodeUsed: true as const,
      }),
    },
    shown: "always",
    history: account,
  } satisfies LoadedContent;
});

/**
 * The account's reservation history. An unavailable history degrades to the
 * section's unavailable notice.
 */
const loadReservationHistory = (account: ReservationHistoryAccount) =>
  Effect.flatMap(CustomerReservationHistoryService, (service) =>
    service.load(account)
  ).pipe(
    degradable(
      "account.reservation-history.unavailable",
      (): CustomerReservationHistory => ({
        kind: "unavailable",
        reason: "provider-unavailable",
      })
    ),
    withOperation("account.reservation-history")
  );

/** Whether a history has a reservation to show, or might have one. */
const mayHaveReservations = (history: CustomerReservationHistory) =>
  history.kind === "unavailable" ||
  Object.values(history.groups).some((group) => group.length > 0);

/**
 * The reservations an account without a usable profile authored for others,
 * shown only when it has any or they can't be read.
 */
const authoredHistory = (user: CustomerAccountSession) =>
  ({
    shown: "when-any",
    history: { accountId: user.accountId },
  }) as const;

/**
 * Whether the session's account is an app-directory review account, or
 * `undefined` when the marker couldn't be read. An unknown account loads as
 * an ordinary one, whose resolution then refuses a review account, but gets
 * no sign-in methods section and, without a profile, no deletion.
 */
const readReviewAccount = (user: CustomerAccountSession) =>
  Effect.flatMap(ReviewAccounts, (accounts) =>
    accounts.isReviewAccount(user.accountId)
  ).pipe(
    degradable("account.review.unavailable", () => undefined),
    withOperation("account.review")
  );

/**
 * The customer's referral summary and share link. An unavailable summary
 * degrades to the referral screen's unavailable state.
 */
const loadReferralOverview = (account: LinkedCustomerAccount) =>
  accountReferralOverview(account).pipe(
    degradable("account.referrals.unavailable", () => undefined),
    withOperation("account.referrals")
  );

/**
 * Read-only check of a remembered code; an unusable code or a failed check
 * leaves the completion form without a prefill instead of blocking sign-up.
 */
const findAvailableReferralCode = (code: ReferralCode) =>
  Effect.flatMap(ReferralService, (service) =>
    service.findAvailableCode({ code })
  ).pipe(
    degradable("account.referral-code.unavailable", () => undefined),
    withOperation("account.referral-code")
  );

/**
 * The remembered referral code from a shared link only matters at sign-up:
 * it prefills first-time profile completion, and it is recorded when this
 * load links the account to an existing Dotypos customer. An account that
 * was already linked ignores it. A linked load also retries the code its
 * profile completion could not record yet, then reports whether the
 * remembered code is used up. While the referral program is withheld, none
 * of this runs: no prefill, acceptance, retry, or settlement check.
 */
const loadSignedInAccount = Effect.fn(function* (
  user: CustomerAccountSession,
  reviewAccount: boolean | undefined
) {
  // A review account never resolves to a Dotypos profile.
  if (reviewAccount) {
    return {
      state: { kind: "review-account", email: user.email },
      shown: "always",
      history: { accountId: user.accountId },
    } satisfies LoadedContent;
  }
  const referralsEnabled = yield* referralsReleased;
  const rememberedReferralCode = yield* Effect.flatMap(
    RememberedReferral,
    (remembered) => remembered.code
  ).pipe(
    degradable("account.remembered-referral.unavailable", () => undefined),
    withOperation("account.remembered-referral")
  );
  const resolution = yield* Effect.flatMap(
    CustomerAccountResolver,
    (resolver) => resolver.resolveLink
  ).pipe(
    // A resolver that couldn't be built reads as the unavailable lock.
    Effect.catchCause((cause) => {
      if (!isRecoverableCause(cause)) {
        return Effect.failCause(failuresAsDefects(cause));
      }
      return Cause.hasFails(cause)
        ? Effect.failCause(cause)
        : Effect.fail(customerAccountUnavailable("account-link.lock"));
    }),
    Effect.tapError((error) =>
      Effect.logError("Account resolution failed", { error })
    ),
    Effect.result,
    withOperation("account.resolve")
  );
  if (Result.isSuccess(resolution)) {
    // Resolution has released the account lock that acceptance takes.
    if (referralsEnabled) {
      yield* replayBuildFailure(ReferralService).pipe(
        Effect.andThen(
          acceptAutoLinkedReferral(resolution.success, rememberedReferralCode)
        ),
        Effect.catchCause(() =>
          logDegradedAccountSection("account.auto-link.referral.unavailable")
        ),
        withOperation("account.auto-link.referral")
      );
    }
    return yield* loadLinkedAccount(
      user,
      resolution.success.account,
      referralsEnabled
    );
  }

  return yield* loadUnlinkedAccount(
    user,
    resolution.failure,
    rememberedReferralCode,
    referralsEnabled
  );
});

/**
 * The state of a signed-in account whose resolution found no usable linked
 * profile: sign-up completion, a support state, or an unavailable account.
 */
const loadUnlinkedAccount = Effect.fn(function* (
  user: CustomerAccountSession,
  failure: CustomerAccountAccessError,
  rememberedReferralCode: ReferralCode | undefined,
  referralsEnabled: boolean
) {
  if (failure.reason === "unauthenticated") {
    return { state: { kind: "unauthenticated" } } satisfies LoadedContent;
  }
  if (isCustomerProfileMissing(failure)) {
    const availableReferralCode =
      rememberedReferralCode === undefined
        ? undefined
        : yield* findAvailableReferralCode(rememberedReferralCode);
    // An account may book for someone else before it completes its own
    // profile; the history then holds only what it authored.
    return {
      state: {
        kind: "completion-required",
        email: user.email,
        referralsEnabled,
        ...(availableReferralCode && { referralCode: availableReferralCode }),
      },
      ...authoredHistory(user),
    } satisfies LoadedContent;
  }
  // The account may still have booked for others meanwhile.
  if (isCustomerAccountSupportRequired(failure)) {
    return {
      state: { kind: "support-required", email: user.email },
      ...authoredHistory(user),
    } satisfies LoadedContent;
  }
  // An unverified email or a pending deletion shows no reservations.
  if (
    failure.reason === "link-required" ||
    failure.reason === "unverified-email"
  ) {
    return {
      state: { kind: "support-required", email: user.email },
    } satisfies LoadedContent;
  }
  return {
    state: { kind: "authenticated-unavailable", email: user.email },
  } satisfies LoadedContent;
});

/**
 * Records a degraded, non-blocking account section with a fixed, non-PII
 * code; the provider or database cause is never attached.
 */
const logDegradedAccountSection = (code: AccountSectionFailureCode) =>
  Effect.logWarning("Account page section unavailable").pipe(
    Effect.annotateLogs({ code })
  );
