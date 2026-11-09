"use client";

import { useEffect } from "react";
import {
  browserCookieJar,
  clearReferralCodeCookie,
} from "./referral-code-cookie";

/**
 * Forgets the remembered referral code from a page whose server render found
 * it used, because Server Components cannot write cookies.
 */
export function ForgetRememberedReferralCode() {
  useEffect(() => {
    clearReferralCodeCookie(
      browserCookieJar,
      window.location.protocol === "https:"
    );
  }, []);
  return null;
}
