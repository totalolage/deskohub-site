import { readDeviceLocale } from "../i18n/device-locale";
import type { ConsentStorage } from "./analytics-consent";
import { consentCookieAssignment, readConsentCookie } from "./consent-cookie";

/**
 * Web consent storage: the site's `cc_cookie` on the shared origin, with no
 * other fallback. It is read again when the page regains focus, so a choice
 * changed on the site applies here too.
 */
export const consentStorage = {
  read: () => readConsentCookie(document.cookie),
  write: async (categories) => {
    // biome-ignore lint/suspicious/noDocumentCookie: the site's consent library reads this cookie, so the app writes the same one.
    document.cookie = consentCookieAssignment({
      cookieString: document.cookie,
      categories,
      now: new Date(),
      hostname: window.location.hostname,
      secure: window.location.protocol === "https:",
      languageCode: readDeviceLocale(),
      createConsentId: () => crypto.randomUUID(),
    });
  },
  watch: (listener) => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") listener();
    };
    window.addEventListener("focus", listener);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", listener);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  },
} satisfies ConsentStorage;
