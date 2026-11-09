import type { DotyposCustomerId } from "@deskohub/dotypos";

export type ReferralAttributionDecision =
  | { readonly kind: "accepted" }
  | { readonly kind: "already_accepted" }
  | { readonly kind: "already_attributed" }
  | { readonly kind: "self_referral" }
  | { readonly kind: "cycle" };

export const evaluateReferralAttribution = (input: {
  readonly invitedCustomerId: DotyposCustomerId;
  readonly referrerCustomerId: DotyposCustomerId;
  readonly existingReferrerByInvitee: ReadonlyMap<
    DotyposCustomerId,
    DotyposCustomerId
  >;
}): ReferralAttributionDecision => {
  if (input.invitedCustomerId === input.referrerCustomerId) {
    return { kind: "self_referral" };
  }

  const existingReferrer = input.existingReferrerByInvitee.get(
    input.invitedCustomerId
  );
  if (existingReferrer) {
    return existingReferrer === input.referrerCustomerId
      ? { kind: "already_accepted" }
      : { kind: "already_attributed" };
  }

  const visited = new Set<DotyposCustomerId>();
  let current = input.referrerCustomerId;
  while (!visited.has(current)) {
    if (current === input.invitedCustomerId) return { kind: "cycle" };
    visited.add(current);
    const next = input.existingReferrerByInvitee.get(current);
    if (!next) return { kind: "accepted" };
    current = next;
  }

  return { kind: "cycle" };
};
