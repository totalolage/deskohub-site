import type { ReferralCode } from "@deskohub/workspace-customer-api";
import { Data, Option } from "effect";

/**
 * What a booking response changed about the referral code the app remembers:
 * remember an accepted code, or forget the one the app sent because it is
 * used up. The app keeps the code itself, as the site's referral cookie does.
 */
export type RememberedReferralUpdate = Data.TaggedEnum<{
  Remember: { readonly code: ReferralCode };
  Forget: Record<never, never>;
}>;
export const RememberedReferralUpdate =
  Data.taggedEnum<RememberedReferralUpdate>();

/** The referral fields a checkout or submission response can carry. */
export interface RememberedReferralSignals {
  readonly rememberReferralCode?: ReferralCode;
  readonly rememberedReferralCodeUsed?: true;
}

/**
 * The update a response asks for. A newly accepted code replaces whatever
 * was remembered, so it wins over a used-up signal for the old code.
 */
export const rememberedReferralUpdate = (
  response: RememberedReferralSignals
): Option.Option<RememberedReferralUpdate> =>
  Option.fromUndefinedOr(response.rememberReferralCode).pipe(
    Option.map((code) => RememberedReferralUpdate.Remember({ code })),
    Option.orElse(() =>
      Option.liftPredicate(
        RememberedReferralUpdate.Forget(),
        () => response.rememberedReferralCodeUsed === true
      )
    )
  );

/** The code to send with later requests after an update. */
export const applyRememberedReferralUpdate = (
  update: RememberedReferralUpdate
): Option.Option<ReferralCode> =>
  RememberedReferralUpdate.$match(update, {
    Remember: ({ code }) => Option.some(code),
    Forget: () => Option.none(),
  });
