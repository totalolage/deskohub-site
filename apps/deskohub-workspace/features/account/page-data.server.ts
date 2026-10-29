import "server-only";

import { Context, Effect, Layer, Result } from "effect";
import type { LazyArg } from "effect/Function";
import { cache } from "react";
import { AccountFeatureFlagService } from "@/features/account/backend/account-feature-flag.service";
import { CustomerAgentConnections } from "@/features/account/backend/auth/customer-agent-connections.service";
import { CustomerPasskeys } from "@/features/account/backend/auth/customer-passkeys.service";
import { acceptAutoLinkedReferral } from "@/features/account/backend/auto-linked-referral";
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
import { isRememberedReferralCodeUsed } from "@/features/account/backend/remembered-referral-code";
import { recordSignupReferral } from "@/features/account/backend/signup-referral";
import type {
  AccountDeletion,
  CustomerAvatarPresentation,
  CustomerProfile,
  CustomerReservationHistory,
  ProfileCompletionReferralOutcome,
} from "@/features/account/contracts";
import {
  type CustomerAccountId,
  isCustomerAccountSupportRequired,
  isCustomerProfileMissing,
  type LinkedCustomerAccount,
  mapCustomerAccountFailure,
} from "@/features/account/customer-account";
import type { CustomerAgentConnection } from "@/features/account/customer-agent-connections";
import type { AccountPasskeySettings } from "@/features/account/passkeys";
import { accountAvatarsEnabled } from "@/features/account/server/account-feature-flag.server";
import { ReferralService } from "@/features/referrals";
import {
  getReferralShareUrl,
  type ReferralCode,
} from "@/features/referrals/client";
import type { ReferralAccountOverview } from "@/features/referrals/contracts";
import { ReferralFeatureFlagRequest } from "@/features/referrals/referral-feature-flag.server";
import { ReferralFeatureFlagService } from "@/features/referrals/referral-feature-flag.service";
import { RememberedReferralCode } from "@/features/referrals/remembered-referral-code.service";
import { ReferralSignupIntentRepository } from "@/features/referrals/signup-intent.repository";
import { ReviewAccounts } from "@/features/review-accounts";
import { getWorkspaceRuntimeCallbackOrigin } from "@/shared/backend/config/workspace-url.config";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";

/**
 * Sign-in methods and connected assistants need only the session, so every
 * signed-in state carries them, whether or not the Dotypos profile is
 * available.
 */
type SessionSettings = {
  /** Whether the page offers deletion; a linked account always does. */
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
 * The closed set of account page states. Every state is derived from the
 * authoritative Better Auth session and the Dotypos link, never from the
 * proxy or cookies.
 */
export type CustomerAccountPageState =
  | { readonly kind: "unavailable" }
  | { readonly kind: "unauthenticated" }
  | SignedInAccountPageState;

type SignedInAccountPageState = SessionSettings & SignedInAccountContent;

type SignedInAccountContent =
  | { readonly kind: "authenticated-unavailable"; readonly email: string }
  | {
      readonly kind: "completion-required";
      readonly email: string;
      /** Whether the referral program is released and offers a code field. */
      readonly referralsEnabled: boolean;
      /** Invitation code to prefill, present only when currently usable. */
      readonly referralCode?: ReferralCode;
      /**
       * The reservations the account booked before completing its profile,
       * present only when it has any or they can't be read.
       */
      readonly history?: CustomerReservationHistory;
    }
  | {
      readonly kind: "linked";
      readonly email: string;
      readonly profile: CustomerProfile;
      readonly avatar: CustomerAvatarPresentation;
      readonly history: CustomerReservationHistory;
      /** Whether the referral program is released and has a section. */
      readonly referralsEnabled: boolean;
      readonly referrals?: ReferralAccountOverview;
      /**
       * Outcome of retrying the code a profile completion could not record
       * yet, present only on the visit that ran the retry. A definitive
       * outcome removes the stored code, so it appears exactly once.
       */
      readonly signupReferral?: ProfileCompletionReferralOutcome;
      /**
       * Present when this browser remembers a referral code that the
       * customer's settled referral has made moot, so the page forgets it.
       */
      readonly rememberedReferralCodeUsed?: true;
    }
  | {
      readonly kind: "support-required";
      readonly email: string;
      /**
       * The reservations the account booked while its profile needs
       * support, present only when it has any or they can't be read.
       */
      readonly history?: CustomerReservationHistory;
    }
  | {
      /**
       * An app-directory review account: no profile, and a history of
       * sample reservations and simulated holds.
       */
      readonly kind: "review-account";
      readonly email: string;
      readonly history: CustomerReservationHistory;
    }
  | { readonly kind: "deletion-pending"; readonly email: string };

interface IAccountPageSectionLayers {
  readonly resolver: Layer.Layer<
    CustomerAccountResolver,
    Layer.Error<typeof CustomerAccountResolver.Live>
  >;
  readonly profile: Layer.Layer<
    CustomerProfileService,
    Layer.Error<typeof CustomerProfileService.Live>
  >;
  readonly history: Layer.Layer<
    CustomerReservationHistoryService,
    Layer.Error<typeof CustomerReservationHistoryService.Live>
  >;
  readonly avatar: Layer.Layer<
    CustomerAvatarService,
    Layer.Error<typeof CustomerAvatarService.Live>
  >;
  readonly referrals: Layer.Layer<
    ReferralService,
    Layer.Error<typeof ReferralService.Live>,
    ReferralFeatureFlagService
  >;
}

/**
 * The capabilities whose construction can fail on Dotypos or Cloudinary
 * configuration. Each step builds its section's layer inside its own
 * recovery, so a failed build degrades that section alone, like an outage of
 * its provider, and a section the page skips is never built.
 */
export class AccountPageSectionLayers extends Context.Service<
  AccountPageSectionLayers,
  IAccountPageSectionLayers
>()("@deskohub-workspace/account/AccountPageSectionLayers") {
  static Live = Layer.succeed(this, {
    resolver: CustomerAccountResolver.Live,
    profile: CustomerProfileService.Live,
    history: CustomerReservationHistoryService.Live,
    avatar: CustomerAvatarService.Live,
    referrals: ReferralService.Live,
  });
}

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

/** Everything the account page reads while it loads. */
type AccountPageCapabilities =
  | CustomerAuthentication
  | CustomerPasskeys
  | CustomerAgentConnections
  | ReviewAccounts
  | ReferralSignupIntentRepository
  | ReferralFeatureFlagService
  | RememberedReferralCode
  | AccountFeatureFlagService
  | AccountPageSectionLayers;

/**
 * Loads the account page state from its capabilities. It never fails: an
 * unreadable session is the unavailable state, and every other section
 * degrades on its own. Every signed-in state, including one without a usable
 * profile, also carries its sign-in methods.
 */
export const loadAccountPageState: Effect.Effect<
  CustomerAccountPageState,
  never,
  AccountPageCapabilities
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
  if (Result.isFailure(session)) return unavailable();

  const user = session.success;
  if (!user) return { kind: "unauthenticated" } as const;
  const reviewAccount = yield* readReviewAccount(user);
  const state = user.deletionRequested
    ? ({ kind: "deletion-pending", email: user.email } as const)
    : yield* loadSignedInAccount(user, reviewAccount);
  if (state.kind === "unauthenticated") return state;
  const { passkeys, assistants } = yield* Effect.all(
    {
      // A review account signs in with its password only.
      passkeys:
        reviewAccount === false
          ? loadPasskeySettings(user.accountId)
          : Effect.succeed(undefined),
      assistants:
        state.kind === "deletion-pending"
          ? Effect.void
          : loadCustomerAgentConnections,
    },
    { concurrency: "unbounded" }
  );
  return {
    ...state,
    deletion: accountDeletion(state, reviewAccount),
    ...(passkeys && { passkeys }),
    ...(assistants !== undefined && { assistants }),
  } satisfies CustomerAccountPageState;
});

/**
 * Loads the account page state behind the page's single runtime edge. The
 * account page is the signed-in customer's site locale, so it reads no
 * separate language preference.
 */
export const loadCustomerAccountPage = cache(
  (): Promise<CustomerAccountPageState> =>
    loadAccountPageState.pipe(
      Effect.provide(
        Layer.mergeAll(
          CustomerAuthentication.Default,
          CustomerPasskeys.Default,
          CustomerAgentConnections.Default,
          ReviewAccounts.Live,
          ReferralSignupIntentRepository.Live,
          RememberedReferralCode.Live,
          AccountFeatureFlagService.Live,
          ReferralFeatureFlagRequest,
          AccountPageSectionLayers.Live
        )
      ),
      runWorkspaceEffect("account.page", { boundary: "page" })
    )
);

const unavailable = (): CustomerAccountPageState => ({ kind: "unavailable" });

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
 * Scopes a step's logs to its own operation name under the page's single
 * runtime edge.
 */
const withOperation = (operation: string) =>
  Effect.annotateLogs({ boundary: "page", operation });

/**
 * Runs a step with its section's capabilities, built for that step, so a
 * failed build is the step's own failure.
 */
const withSectionLayer =
  <ROut, E, RIn>(
    select: (layers: IAccountPageSectionLayers) => Layer.Layer<ROut, E, RIn>
  ) =>
  <A, E1, R>(self: Effect.Effect<A, E1, R>) =>
    Effect.flatMap(AccountPageSectionLayers, (layers) =>
      Effect.provide(self, select(layers))
    );

/**
 * Degrades a non-blocking section to `fallback`, logging only its fixed
 * code; the provider or database cause is never attached.
 */
const degradable =
  <B>(code: AccountSectionFailureCode, fallback: LazyArg<B>) =>
  <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A | B, never, R> =>
    self.pipe(
      Effect.tapError(() => logDegradedAccountSection(code)),
      Effect.orElseSucceed(fallback)
    );

/**
 * Whether the referral program is released: the request's one decision,
 * shared with the account layout's navigation and every referral service of
 * this load. An unavailable evaluation fails closed: a withheld program
 * reads, writes, and shows no referral state.
 */
const referralsReleased = ReferralFeatureFlagService.pipe(
  Effect.flatMap((featureFlag) => featureFlag.isEnabled)
);

/**
 * The Sign-in & security section's passkeys while `login_passkeys` is on. An
 * unreadable flag counts as off; an unreadable list keeps the section with
 * an unavailable notice.
 */
const loadPasskeySettings = Effect.fn(function* (accountId: CustomerAccountId) {
  const passkeysEnabled = yield* AccountFeatureFlagService.pipe(
    Effect.flatMap((featureFlag) => featureFlag.isPasskeyEnabled),
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
  referralsEnabled: boolean,
  rememberedReferralCode: ReferralCode | undefined
) {
  const profile = yield* Effect.flatMap(CustomerProfileService, (service) =>
    service.load(account)
  ).pipe(
    withSectionLayer((layers) => layers.profile),
    Effect.tapError((error) =>
      Effect.logError("Account profile load failed", { error })
    ),
    Effect.result,
    withOperation("account.profile.read")
  );
  if (Result.isFailure(profile)) {
    return {
      kind: "authenticated-unavailable",
      email: user.email,
    } satisfies SignedInAccountContent;
  }

  // Retries a profile-completion referral that is still waiting, outside any
  // account lock like the auto-link before it. It runs only once the linked
  // page is certain to render, so the visit that settles the code is the one
  // that shows its outcome. A withheld program leaves the stored code as is.
  const signupReferral = referralsEnabled
    ? yield* recordSignupReferral(account).pipe(
        withSectionLayer((layers) => layers.referrals),
        Effect.catchCause(() =>
          logDegradedAccountSection("account.signup-referral.unavailable").pipe(
            Effect.as(undefined)
          )
        ),
        withOperation("account.signup-referral")
      )
    : undefined;
  // Checked after both recording paths, so a code they just used is forgotten
  // on this visit.
  const rememberedReferralCodeUsed =
    referralsEnabled &&
    (yield* isRememberedReferralCodeUsed(rememberedReferralCode, account).pipe(
      withSectionLayer((layers) => layers.referrals),
      degradable("account.remembered-referral.unavailable", () => false),
      withOperation("account.remembered-referral")
    ));

  const history = yield* loadReservationHistory(account);

  // An unavailable avatar capability evaluation fails closed to hidden.
  const avatarsEnabled = yield* accountAvatarsEnabled.pipe(
    withOperation("account.avatars-enabled")
  );
  let avatar: CustomerAvatarPresentation = { kind: "hidden" };
  if (avatarsEnabled) {
    // A media outage never blocks the account page: an avatar read failure
    // degrades to the initials fallback.
    const availableAvatar = yield* Effect.flatMap(
      CustomerAvatarService,
      (service) => service.lookup(account.accountId)
    ).pipe(
      withSectionLayer((layers) => layers.avatar),
      degradable("account.avatar.unavailable", () => null),
      withOperation("account.avatar")
    );
    avatar = { kind: "available", avatar: availableAvatar };
  }

  const referrals = referralsEnabled
    ? yield* loadReferralOverview(account)
    : undefined;

  return {
    kind: "linked",
    email: user.email,
    profile: profile.success,
    avatar,
    history,
    referralsEnabled,
    referrals,
    ...(signupReferral && { signupReferral }),
    ...(rememberedReferralCodeUsed && {
      rememberedReferralCodeUsed: true as const,
    }),
  } satisfies SignedInAccountContent;
});

/**
 * The account's reservation history. An unavailable history degrades to the
 * section's unavailable notice.
 */
const loadReservationHistory = (account: ReservationHistoryAccount) =>
  Effect.flatMap(CustomerReservationHistoryService, (service) =>
    service.load(account)
  ).pipe(
    withSectionLayer((layers) => layers.history),
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
 * attached only when it has any or they can't be read.
 */
const loadAuthoredHistory = (user: CustomerAccountSession) =>
  loadReservationHistory({ accountId: user.accountId }).pipe(
    Effect.map((history) => (mayHaveReservations(history) ? { history } : {}))
  );

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
  Effect.flatMap(ReferralService, (service) =>
    service.getAccountSummary({
      customerAccountId: account.accountId,
      dotyposCustomerId: account.dotyposCustomerId,
    })
  ).pipe(
    Effect.flatMap((summary) =>
      getWorkspaceRuntimeCallbackOrigin.pipe(
        Effect.map(
          (origin): ReferralAccountOverview => ({
            summary,
            shareUrl: getReferralShareUrl(summary.code, origin),
          })
        )
      )
    ),
    withSectionLayer((layers) => layers.referrals),
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
    withSectionLayer((layers) => layers.referrals),
    degradable("account.referral-code.unavailable", () => undefined),
    withOperation("account.referral-code")
  );

/**
 * The referral code this browser remembers from a shared link only matters at
 * sign-up: it prefills first-time profile completion, and it is recorded when
 * this visit links the account to an existing Dotypos customer. An account
 * that was already linked ignores it. A linked visit also retries the code its
 * profile completion could not record yet, then reports whether the
 * remembered code is used up. While the referral program is withheld, none of
 * this runs: no prefill, acceptance, retry, or settlement check.
 */
const loadSignedInAccount = Effect.fn(function* (
  user: CustomerAccountSession,
  reviewAccount: boolean | undefined
) {
  // A review account never resolves to a Dotypos profile.
  if (reviewAccount) {
    return {
      kind: "review-account",
      email: user.email,
      history: yield* loadReservationHistory({ accountId: user.accountId }),
    } satisfies SignedInAccountContent;
  }
  const referralsEnabled = yield* referralsReleased;
  const rememberedReferralCode = referralsEnabled
    ? yield* Effect.flatMap(
        RememberedReferralCode,
        (remembered) => remembered.current
      ).pipe(Effect.orElseSucceed(() => undefined))
    : undefined;
  const resolution = yield* Effect.flatMap(
    CustomerAccountResolver,
    (resolver) => resolver.resolveLink
  ).pipe(
    withSectionLayer((layers) => layers.resolver),
    Effect.mapError(mapCustomerAccountFailure("account-link.lock")),
    Effect.tapError((error) =>
      Effect.logError("Account resolution failed", { error })
    ),
    Effect.result,
    withOperation("account.resolve")
  );
  if (Result.isSuccess(resolution)) {
    // Resolution has released the account lock that acceptance takes.
    if (referralsEnabled) {
      yield* acceptAutoLinkedReferral(
        resolution.success,
        rememberedReferralCode
      ).pipe(
        withSectionLayer((layers) => layers.referrals),
        Effect.catchCause(() =>
          logDegradedAccountSection("account.auto-link.referral.unavailable")
        ),
        withOperation("account.auto-link.referral")
      );
    }
    return yield* loadLinkedAccount(
      user,
      resolution.success.account,
      referralsEnabled,
      rememberedReferralCode
    );
  }

  const failure = resolution.failure;
  if (failure.reason === "unauthenticated") {
    return { kind: "unauthenticated" } as const;
  }
  if (isCustomerProfileMissing(failure)) {
    const availableReferralCode =
      rememberedReferralCode === undefined
        ? undefined
        : yield* findAvailableReferralCode(rememberedReferralCode);
    // An account may book for someone else before it completes its own
    // profile; the history then holds only what it authored.
    const authoredHistory = yield* loadAuthoredHistory(user);
    return {
      kind: "completion-required",
      email: user.email,
      referralsEnabled,
      ...(availableReferralCode && { referralCode: availableReferralCode }),
      ...authoredHistory,
    } satisfies SignedInAccountContent;
  }
  // The account may still have booked for others meanwhile.
  if (isCustomerAccountSupportRequired(failure)) {
    const authoredHistory = yield* loadAuthoredHistory(user);
    return {
      kind: "support-required",
      email: user.email,
      ...authoredHistory,
    } satisfies SignedInAccountContent;
  }
  // An unverified email or a pending deletion shows no reservations.
  if (
    failure.reason === "link-required" ||
    failure.reason === "unverified-email"
  ) {
    return { kind: "support-required", email: user.email } as const;
  }
  return { kind: "authenticated-unavailable", email: user.email } as const;
});

/**
 * Records a degraded, non-blocking account section with a fixed, non-PII
 * code; the provider or database cause is never attached.
 */
const logDegradedAccountSection = (code: AccountSectionFailureCode) =>
  Effect.logWarning("Account page section unavailable").pipe(
    Effect.annotateLogs({ code })
  );
