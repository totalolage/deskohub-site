import {
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
} from "@deskohub/dotypos";
import { Effect, Schema } from "effect";
import {
  makeSignedClaims,
  type SignedClaimsKeyRing,
} from "@/shared/backend/signed-claims";
import {
  type CampaignSendId,
  campaignSendIdSchema,
} from "./campaign-identifiers";

/** The frozen recipient an unsubscribe link speaks for. */
export type CampaignUnsubscribeRecipient = {
  readonly sendId: CampaignSendId;
  readonly dotyposCustomerId: DotyposCustomerId;
};

// The MAC covers the bare payload: links in sent emails carry no purpose
// prefix, and the HKDF-derived key already binds the token to unsubscribing.
const unsubscribeTokenClaims = makeSignedClaims({
  purpose: undefined,
  schema: Schema.Tuple([campaignSendIdSchema, DotyposCustomerIdSchema]),
});

/**
 * Signs a recipient into an unsubscribe token with the first key of `keys`.
 * It carries no expiry: a one-click unsubscribe link must keep working for as
 * long as the email sits in an inbox, and the token is deterministic so a
 * replayed provider batch renders the same email.
 */
export const signCampaignUnsubscribeToken = Effect.fn(
  "campaignUnsubscribeToken.sign"
)(function* (
  keys: SignedClaimsKeyRing,
  recipient: CampaignUnsubscribeRecipient
) {
  // A typed recipient always encodes; a failure here is a defect.
  return yield* unsubscribeTokenClaims
    .sign([recipient.sendId, recipient.dotyposCustomerId], keys)
    .pipe(Effect.orDie);
});

/**
 * Opens a token signed by any of `keys`, so links in sent emails survive a
 * signing-secret rotation while the old secret stays listed. A malformed or
 * forged token opens to nothing.
 */
export const openCampaignUnsubscribeToken = Effect.fn(
  "campaignUnsubscribeToken.open"
)(function* (keys: SignedClaimsKeyRing, token: string) {
  return yield* unsubscribeTokenClaims.open(token, Effect.succeed(keys)).pipe(
    Effect.map(
      ([sendId, dotyposCustomerId]): CampaignUnsubscribeRecipient => ({
        sendId,
        dotyposCustomerId,
      })
    ),
    Effect.option
  );
});
