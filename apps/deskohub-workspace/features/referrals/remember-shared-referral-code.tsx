"use client";

import { useEffect } from "react";
import {
  browserCookieJar,
  findSharedReferralCodeToRemember,
  setReferralCodeCookie,
} from "./referral-code-cookie";

const isPrerendering = () =>
  (document as Document & { readonly prerendering?: boolean }).prerendering ===
  true;

/**
 * Remembers the shared referral code in the address of the page being shown,
 * only when none is remembered yet. The proxy cannot read the referral feature
 * flag, so capture happens here, once the page is really shown: a
 * speculatively prerendered page waits for activation, and a page shown inside
 * a frame never remembers. The server render of the landing page did not see
 * the code; later navigations do.
 */
export function RememberSharedReferralCode() {
  useEffect(() => {
    // Comparing window proxies is allowed even under a cross-origin parent.
    if (window.self !== window.top) return;
    const remember = () => {
      const code = findSharedReferralCodeToRemember(
        new URL(window.location.href).searchParams,
        browserCookieJar
      );
      if (code) {
        setReferralCodeCookie(
          browserCookieJar,
          code,
          window.location.protocol === "https:"
        );
      }
    };
    if (!isPrerendering()) {
      remember();
      return;
    }
    document.addEventListener("prerenderingchange", remember, { once: true });
    return () => document.removeEventListener("prerenderingchange", remember);
  }, []);
  return null;
}
