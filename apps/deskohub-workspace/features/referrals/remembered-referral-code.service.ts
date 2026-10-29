import { type Cause, Context, Effect, Layer } from "effect";
import { cookies } from "next/headers";
import type { ReferralCode } from "./client";
import {
  parseSharedReferralCode,
  referralCodeCookieName,
} from "./referral-code-cookie";

interface IRememberedReferralCode {
  /**
   * The referral code this browser remembers from a shared link, if any,
   * whether or not the referral program is released.
   */
  readonly current: Effect.Effect<ReferralCode | undefined, Cause.UnknownError>;
}

export class RememberedReferralCode extends Context.Service<
  RememberedReferralCode,
  IRememberedReferralCode
>()("@deskohub-workspace/referrals/RememberedReferralCode") {
  static Live = Layer.succeed(this, {
    current: Effect.tryPromise(() => cookies()).pipe(
      Effect.map((jar) =>
        parseSharedReferralCode(jar.get(referralCodeCookieName)?.value)
      )
    ),
  });
}
