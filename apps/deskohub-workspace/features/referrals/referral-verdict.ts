import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Match } from "effect";
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

/** Every recorded referral, as each invited customer's referrer. */
export type ReferrerByInvitee = ReadonlyMap<
  DotyposCustomerId,
  DotyposCustomerId
>;

/**
 * What a referral code does for a customer: invite them, confirm the referral
 * they already accepted from the same referrer, or a rejection.
 */
export type ReferralVerdict =
  | { readonly kind: "eligible"; readonly referral: InvitationReferral }
  | { readonly kind: "already_accepted"; readonly referral: InvitationReferral }
  | { readonly kind: "rejected"; readonly reason: ReferralRejection };

/**
 * How far the rules got with the facts they were given: a verdict, or the
 * next fact they need. The context reads that fact its own way and resumes
 * with it, so a fact is read only once a rule reaches it: a checkout without
 * locks, acceptance under its locks inside its transaction.
 */
export type ReferralEvaluation =
  | { readonly kind: "decided"; readonly verdict: ReferralVerdict }
  | {
      readonly kind: "needs_attribution";
      /** Resumes with the customer's permanent referral, if they have one. */
      readonly resume: (
        attribution: InvitationReferral | undefined
      ) => ReferralEvaluation;
    }
  | {
      readonly kind: "needs_invitation_window";
      readonly resume: (
        invitationWindow: InvitationWindow
      ) => ReferralEvaluation;
    }
  | {
      readonly kind: "needs_referrer_by_invitee";
      readonly resume: (
        referrerByInvitee: ReferrerByInvitee
      ) => ReferralEvaluation;
    };

const decided = (verdict: ReferralVerdict): ReferralEvaluation => ({
  kind: "decided",
  verdict,
});

const rejection = (reason: ReferralRejection): ReferralVerdict => ({
  kind: "rejected",
  reason,
});

const rejected = (reason: ReferralRejection): ReferralEvaluation =>
  decided(rejection(reason));

/**
 * Decides what the code does for the customer: the code must currently refer
 * someone other than the customer; an existing referral settles it; then the
 * first-booking invitation must be open and the new referral must not close a
 * cycle. It reads nothing: it starts from the code's invitation (`target`,
 * while an enabled referral code inside its validity window has an owner with
 * an active linked account) and asks for each further fact in turn, so a
 * settled verdict never waits on Dotypos.
 */
export const evaluateReferral = (input: {
  readonly invitedDotyposCustomerId: DotyposCustomerId;
  readonly target: InvitationReferral | undefined;
}): ReferralEvaluation => {
  const { invitedDotyposCustomerId, target } = input;
  if (target === undefined) return rejected("unavailable");
  if (target.referrerDotyposCustomerId === invitedDotyposCustomerId) {
    return rejected("self_referral");
  }
  return {
    kind: "needs_attribution",
    resume: (attribution) =>
      attribution === undefined
        ? judgeInvitationWindow({ invitedDotyposCustomerId, target })
        : judgeExistingReferral({ target, attribution }),
  };
};

/** A customer's referral is permanent: only the same referrer confirms it. */
const judgeExistingReferral = (input: {
  readonly target: InvitationReferral;
  readonly attribution: InvitationReferral;
}): ReferralEvaluation =>
  input.attribution.referrerDotyposCustomerId ===
  input.target.referrerDotyposCustomerId
    ? decided({ kind: "already_accepted", referral: input.attribution })
    : rejected("already_attributed");

/** Only an open first-booking invitation can be taken. */
const judgeInvitationWindow = (input: {
  readonly invitedDotyposCustomerId: DotyposCustomerId;
  readonly target: InvitationReferral;
}): ReferralEvaluation => ({
  kind: "needs_invitation_window",
  resume: (invitationWindow) => {
    if (invitationWindow === "closed") return rejected("ineligible");
    if (invitationWindow === "held") return rejected("pending_payment");
    return {
      kind: "needs_referrer_by_invitee",
      resume: (referrerByInvitee) =>
        decided(judgeReferralGraph({ ...input, referrerByInvitee })),
    };
  },
});

/** The new referral must keep the referral graph acyclic. */
const judgeReferralGraph = (input: {
  readonly invitedDotyposCustomerId: DotyposCustomerId;
  readonly target: InvitationReferral;
  readonly referrerByInvitee: ReferrerByInvitee;
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
      already_attributed: () => rejection("already_attributed"),
      self_referral: () => rejection("self_referral"),
      cycle: () => rejection("cycle"),
    })
  );
