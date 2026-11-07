import { Data, Effect } from "effect";

/** An account feature that ships behind a release gate. */
export type AccountFeature = "avatars" | "passkeys" | "referrals";

/**
 * The feature's release gate is closed for this request, so its account
 * operations refuse before touching the account. Every caller words it as
 * "unavailable".
 */
export class AccountFeatureWithheldError extends Data.TaggedError(
  "AccountFeatureWithheldError"
)<{ readonly feature: AccountFeature }> {}

/**
 * Lets the operation continue only while the feature's gate is open. The
 * gate's own decision already fails closed.
 */
export const requireAccountFeature = <R>(
  feature: AccountFeature,
  isOpen: Effect.Effect<boolean, never, R>
) =>
  isOpen.pipe(
    Effect.filterOrFail(
      (open) => open,
      () => new AccountFeatureWithheldError({ feature })
    ),
    Effect.asVoid
  );
