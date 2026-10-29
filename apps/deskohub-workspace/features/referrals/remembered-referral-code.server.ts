import "server-only";

import { Effect } from "effect";
import { cookies, headers } from "next/headers";
import type { ReferralCode } from "./client";
import {
  clearReferralCodeCookie,
  setReferralCodeCookie,
} from "./referral-code-cookie";
import { ReferralFeatureFlagService } from "./referral-feature-flag.service";
import { RememberedReferralCode } from "./remembered-referral-code.service";

/**
 * The referral code this browser remembers from a shared link, if any. While
 * the referral program is withheld, a remembered code is ignored. It reads the
 * request's provided decision, so an action or page that already decided
 * never evaluates the flag again.
 */
export const readRememberedReferralCode = ReferralFeatureFlagService.pipe(
  Effect.flatMap((featureFlag) => featureFlag.isEnabled),
  Effect.flatMap((released) =>
    released
      ? Effect.flatMap(
          RememberedReferralCode,
          (remembered) => remembered.current
        ).pipe(Effect.provide(RememberedReferralCode.Live))
      : Effect.undefined
  )
);

const isSecureRequest = async () =>
  (await headers()).get("x-forwarded-proto") !== "http";

/**
 * Remembers a referral code the customer typed and checkout accepted,
 * replacing any shared-link code: a typed code wins, and an order edit then
 * keeps it. Server Actions and route handlers only.
 */
export const rememberReferralCode = async (code: ReferralCode) => {
  setReferralCodeCookie(await cookies(), code, await isSecureRequest());
};

/**
 * Forgets the remembered code from a Server Action or route handler. Server
 * Components cannot write cookies; they render `ForgetRememberedReferralCode`.
 */
export const forgetRememberedReferralCode = async () => {
  clearReferralCodeCookie(await cookies(), await isSecureRequest());
};
