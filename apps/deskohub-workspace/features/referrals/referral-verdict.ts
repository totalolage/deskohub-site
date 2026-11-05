import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Effect, Match } from "effect";
import type { PromotionCodeId } from "@/features/discounts/persistence-contracts";
import { evaluateReferralAttribution } from "./attribution";
import type { ReferralRejection } from "./contracts";

/** The referrer and registry code an invitation comes through. */
export type InvitationReferral = {
  readonly referrerDotyposCustomerId: DotyposCustomerId;
  readonly promotionCodeId: PromotionCodeId;
};

/**
 * Whether the customer's first-booking invitation can still be taken: `open`,
 * `closed` by a paid booking, or `held` by a payment in progress that may
 * still become that first paid booking. Each context decides what holds it.
 */
export type InvitationWindow = "open" | "held" | "closed";

/**
 * What a referral code does for a customer: invite them, confirm the referral
 * they already accepted from the same referrer, or a rejection.
 */
type ReferralVerdict =
  | { readonly kind: "eligible"; readonly referral: InvitationReferral }
  | { readonly kind: "already_accepted"; readonly referral: InvitationReferral }
  | { readonly kind: "rejected"; readonly reason: ReferralRejection };

/**
 * The facts a verdict rests on, as loaders a context supplies. A checkout
 * reads them without locks; acceptance reads them under its locks inside its
 * transaction. Their failures are the context's own and pass through as is.
 */
export type ReferralFacts<E, R> = {
  readonly invitedDotyposCustomerId: DotyposCustomerId;
  /**
   * The code's invitation while it can refer anyone: an enabled referral code
   * inside its validity window whose owner has an active linked account.
   */
  readonly target: Effect.Effect<InvitationReferral | undefined, E, R>;
  /** The customer's permanent referral, if they have one. */
  readonly attribution: Effect.Effect<InvitationReferral | undefined, E, R>;
  readonly invitationWindow: Effect.Effect<InvitationWindow, E, R>;
  /** Every recorded referral, as each invited customer's referrer. */
  readonly referrerByInvitee: Effect.Effect<
    ReadonlyMap<DotyposCustomerId, DotyposCustomerId>,
    E,
    R
  >;
};

const rejected = (reason: ReferralRejection): ReferralVerdict => ({
  kind: "rejected",
  reason,
});

/**
 * Decides what the code does for the customer: the code must currently refer
 * someone other than the customer; an existing referral settles it; then the
 * first-booking invitation must be open and the new referral must not close a
 * cycle. It reads nothing itself, runs one loader at a time, and loads a fact
 * only once the rules reach it, so a settled verdict never waits on Dotypos
 * and the evaluation is safe inside a transaction.
 */
export const evaluateReferral = Effect.fn("ReferralVerdict.evaluate")(
  function* <E, R>(facts: ReferralFacts<E, R>) {
    const target = yield* facts.target;
    if (target === undefined) return rejected("unavailable");
    if (target.referrerDotyposCustomerId === facts.invitedDotyposCustomerId) {
      return rejected("self_referral");
    }

    const attribution = yield* facts.attribution;
    if (attribution !== undefined) {
      return judgeExistingReferral({ target, attribution });
    }

    const window = yield* facts.invitationWindow;
    if (window === "closed") return rejected("ineligible");
    if (window === "held") return rejected("pending_payment");

    return judgeReferralGraph({
      invitedDotyposCustomerId: facts.invitedDotyposCustomerId,
      target,
      referrerByInvitee: yield* facts.referrerByInvitee,
    });
  }
);

/** A customer's referral is permanent: only the same referrer confirms it. */
const judgeExistingReferral = (input: {
  readonly target: InvitationReferral;
  readonly attribution: InvitationReferral;
}): ReferralVerdict =>
  input.attribution.referrerDotyposCustomerId ===
  input.target.referrerDotyposCustomerId
    ? { kind: "already_accepted", referral: input.attribution }
    : rejected("already_attributed");

/** The new referral must keep the referral graph acyclic. */
const judgeReferralGraph = (input: {
  readonly invitedDotyposCustomerId: DotyposCustomerId;
  readonly target: InvitationReferral;
  readonly referrerByInvitee: ReadonlyMap<DotyposCustomerId, DotyposCustomerId>;
}): ReferralVerdict =>
  Match.value(
    evaluateReferralAttribution({
      invitedCustomerId: input.invitedDotyposCustomerId,
      referrerCustomerId: input.target.referrerDotyposCustomerId,
      existingReferrerByInvitee: input.referrerByInvitee,
    })
  ).pipe(
    Match.discriminatorsExhaustive("kind")({
      accepted: (): ReferralVerdict => ({
        kind: "eligible",
        referral: input.target,
      }),
      // An attribution recorded after the customer's own was read; under the
      // acceptance's locks neither can happen.
      already_accepted: (): ReferralVerdict => ({
        kind: "already_accepted",
        referral: input.target,
      }),
      already_attributed: () => rejected("already_attributed"),
      self_referral: () => rejected("self_referral"),
      cycle: () => rejected("cycle"),
    })
  );
