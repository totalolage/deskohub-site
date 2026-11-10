import { Effect, Match, Result } from "effect";
import type { ReferralSignupOutcome } from "@/db/schema/referrals";
import { ReferralService } from "@/features/referrals";
import type {
  ReferralAccountOutage,
  ReferralError,
} from "@/features/referrals/contracts";
import { referralFailureLogFields } from "@/features/referrals/referral-failure";
import { ReferralReleaseGate } from "@/features/referrals/referral-release-gate";
import {
  type ReferralSignupIntent,
  ReferralSignupIntentRepository,
} from "@/features/referrals/signup-intent.repository";
import type { ProfileCompletionReferralOutcome } from "../contracts";
import {
  type LinkedCustomerAccount,
  mapCustomerAccountFailure,
} from "../customer-account";
import { requireAccountFeature } from "./account-feature-withheld";
import { CustomerAccountResolver } from "./customer-account-resolver.service";

const applied = { status: "applied" } as const;
const pending = { status: "pending" } as const;
const notApplied = (
  reason: Extract<
    ProfileCompletionReferralOutcome,
    { readonly status: "not-applied" }
  >["reason"]
) => ({ status: "not-applied", reason }) as const;

const normalizeEnteredCode = (code: string) => code.trim().toUpperCase();

/**
 * Checks the code entered at first-time completion before anything is
 * created. A typed code that cannot be used now rejects the completion. A code
 * still equal to the shared-link prefill is dropped silently instead, because
 * it may have stopped being usable after the page rendered, and a link must
 * never block sign-up.
 */
export const prepareSignupReferral = Effect.fn("account.prepareSignupReferral")(
  function* (input: {
    readonly code: string | undefined;
    readonly prefilledCode: string | undefined;
  }) {
    if (input.code === undefined) return { kind: "none" } as const;

    const referrals = yield* ReferralService;
    const intents = yield* ReferralSignupIntentRepository;
    const lookup = yield* referrals
      .findAvailableCode({ code: input.code })
      .pipe(
        Effect.flatMap((code) =>
          code === undefined ? Effect.undefined : intents.findCodeTarget(code)
        ),
        Effect.result
      );
    // A withheld program ignores the code rather than reporting it unusable.
    // A failed lookup reads as an unusable code, so the completion can be
    // retried with it or without it.
    if (
      Result.isFailure(lookup) &&
      lookup.failure._tag === "ReferralError" &&
      lookup.failure.reason === "disabled"
    ) {
      return { kind: "none" } as const;
    }
    const target = Result.getOrUndefined(lookup);
    if (target) return { kind: "intent", intent: target } as const;

    const fromSharedLink =
      input.prefilledCode !== undefined &&
      normalizeEnteredCode(input.code) ===
        normalizeEnteredCode(input.prefilledCode);
    if (!fromSharedLink) return { kind: "unavailable" } as const;

    yield* Effect.logInfo(
      "Shared-link referral code was dropped at profile completion"
    ).pipe(Effect.annotateLogs({ code: "account.complete-profile.referral" }));
    return { kind: "none" } as const;
  }
);

/** What a verdict on the stored code means for it. */
const classifyRejection = (
  reason: ReferralError["reason"]
): ProfileCompletionReferralOutcome =>
  Match.value(reason).pipe(
    Match.when("already_attributed", () => notApplied("already-referred")),
    Match.when("ineligible", () => notApplied("not-eligible")),
    Match.when(
      Match.is("self_referral", "invalid_code", "cycle", "unavailable"),
      () => notApplied("code-unusable")
    ),
    // A pending payment may still become the first paid booking, either
    // closing the window or recording that checkout's own referral; the
    // retry after it settles reports whichever happened. A referrer who
    // relinked during acceptance is decided by the next attempt.
    // A withheld program, or a flag that could not be read, says nothing
    // about the code: the intent waits for the program.
    Match.when(
      Match.is(
        "pending_payment",
        "account_unavailable",
        "referrer_changed",
        "disabled"
      ),
      () => pending
    ),
    Match.exhaustive
  );

/**
 * Only a verdict settles the stored code. A failed database, Dotypos,
 * session, or account check says nothing about it, so the intent stays pending for the
 * next load.
 */
const classifyAcceptanceFailure = Match.type<
  ReferralError | ReferralAccountOutage
>().pipe(
  Match.tagsExhaustive({
    ReferralError: ({ reason }) => classifyRejection(reason),
    ReferralAuthenticationUnavailable: () => pending,
    ReferralAccountCheckUnavailable: () => pending,
    EffectDrizzleQueryError: () => pending,
    SqlError: () => pending,
    DotyposUnavailable: () => pending,
    DotyposRejected: () => pending,
  })
);

/**
 * The stored completion code's outcome for the account page, and the retry
 * that settles it. Run this only once no account lock or transaction is held.
 *
 * - An unsettled code is retried. A definitive result is recorded with one
 *   conditional update, so concurrent loads settle it once; a load that loses
 *   that race reports the stored winner. A transient failure stays pending.
 * - A settled code reports its stored outcome on every load without retrying,
 *   so an abandoned response or a second tab never loses it.
 * - An acknowledged code, or none, reports nothing.
 */
export const recordSignupReferral = Effect.fn("account.recordSignupReferral")(
  function* (account: LinkedCustomerAccount) {
    const intents = yield* ReferralSignupIntentRepository;
    const intent = yield* intents.find(account.accountId);
    if (!intent || intent.acknowledged) return undefined;
    if (intent.outcome !== null) return toOutcome(intent.outcome);

    const outcome = yield* checkSignupReferral(account, intent);
    if (outcome.status === "pending") return outcome;
    return yield* settleSignupReferral(account, intent, outcome);
  }
);

type StoredSignupIntent = NonNullable<
  Effect.Success<ReturnType<ReferralSignupIntentRepository["Service"]["find"]>>
>;

/** Retries the stored code's acceptance and logs what it found. */
const checkSignupReferral = Effect.fnUntraced(function* (
  account: LinkedCustomerAccount,
  intent: StoredSignupIntent
) {
  const referrals = yield* ReferralService;
  const acceptance = yield* referrals
    .acceptReferral({
      code: intent.code,
      customerAccountId: account.accountId,
      dotyposCustomerId: account.dotyposCustomerId,
    })
    .pipe(Effect.result);
  const outcome: ProfileCompletionReferralOutcome = Result.isSuccess(acceptance)
    ? applied
    : classifyAcceptanceFailure(acceptance.failure);
  yield* Effect.logInfo("Referral signup intent checked").pipe(
    Effect.annotateLogs({
      code: "account.signup-referral",
      outcome: outcome.status,
      ...(Result.isFailure(acceptance) &&
        referralFailureLogFields(acceptance.failure)),
    })
  );
  return outcome;
});

/**
 * Records a definitive outcome once; a load that loses the race reports the
 * stored winner unless it was acknowledged meanwhile.
 */
const settleSignupReferral = Effect.fnUntraced(function* (
  account: LinkedCustomerAccount,
  intent: ReferralSignupIntent,
  outcome: Exclude<ProfileCompletionReferralOutcome, { status: "pending" }>
) {
  const intents = yield* ReferralSignupIntentRepository;
  const settled = yield* intents.settle(
    account.accountId,
    intent.promotionCodeId,
    toStoredOutcome(outcome)
  );
  if (settled) return outcome;
  const winner = yield* intents.find(account.accountId);
  return winner?.outcome && !winner.acknowledged
    ? toOutcome(winner.outcome)
    : undefined;
});

/**
 * Hides the settled outcome of the referral code the current session's
 * account entered at profile completion. The notice shows from stored state
 * until this runs. A withheld referral program shows no notice, so it
 * refuses and leaves the stored outcome untouched.
 */
export const acknowledgeCurrentSignupReferral = Effect.fn(
  "account.acknowledgeCurrentSignupReferral"
)(function* () {
  yield* requireAccountFeature("referrals", ReferralReleaseGate.isOpen);
  const account = yield* Effect.flatMap(
    CustomerAccountResolver,
    (resolver) => resolver.resolve
  );
  yield* acknowledgeSignupReferral(account).pipe(
    Effect.mapError(mapCustomerAccountFailure("referral.signup-acknowledge"))
  );
  return { status: "acknowledged" } as const;
});

/** Hides the account's settled completion-code outcome for good. */
export const acknowledgeSignupReferral = Effect.fn(
  "account.acknowledgeSignupReferral"
)(function* (account: LinkedCustomerAccount) {
  const intents = yield* ReferralSignupIntentRepository;
  yield* intents.acknowledge(account.accountId);
});

const toStoredOutcome = (
  outcome: Exclude<ProfileCompletionReferralOutcome, { status: "pending" }>
): ReferralSignupOutcome => {
  if (outcome.status === "applied") return "applied";
  // Only a losing completion reports this; acceptance never settles with it.
  if (outcome.reason === "profile-already-completed") return "code-unusable";
  return outcome.reason;
};

const toOutcome = (
  outcome: ReferralSignupOutcome
): ProfileCompletionReferralOutcome =>
  outcome === "applied" ? applied : notApplied(outcome);

/**
 * Reports a completion's code from the account's current referral state when
 * this completion did not record it itself: another completion created the
 * link first, or the stored intent was already settled.
 */
export const describeSignupReferral = Effect.fn(
  "account.describeSignupReferral"
)(function* (
  account: LinkedCustomerAccount,
  intent: ReferralSignupIntent,
  created: boolean
) {
  const intents = yield* ReferralSignupIntentRepository;
  const unrecorded = created
    ? notApplied("code-unusable")
    : notApplied("profile-already-completed");

  return yield* Effect.gen(function* () {
    const attributedCode = yield* intents.findAttributedCode(
      account.dotyposCustomerId
    );
    if (attributedCode !== undefined) {
      return attributedCode === intent.promotionCodeId
        ? applied
        : notApplied("already-referred");
    }
    const stored = yield* intents.find(account.accountId);
    if (stored) {
      if (stored.promotionCodeId !== intent.promotionCodeId) {
        return notApplied("already-referred");
      }
      return stored.outcome === null ? pending : toOutcome(stored.outcome);
    }
    return unrecorded;
  }).pipe(Effect.orElseSucceed(() => (created ? pending : unrecorded)));
});
