/**
 * Cookie Consent Feature Module
 * Public API exports
 */

export { CookieConsentProvider } from "./components/cookie-consent-provider";
export type { ConsentCategory } from "./config/consent-config";
export { useCookieConsent } from "./hooks/use-cookie-consent";
export {
  type ConsentState,
  type ConsentStatus,
  DEFAULT_CONSENT_STATE,
  denyAnalyticsConsent,
  denyMarketingConsent,
  denyPreferencesConsent,
  grantAnalyticsConsent,
  grantMarketingConsent,
  grantPreferencesConsent,
  initializeConsentMode,
  updateConsentMode,
} from "./utils/consent-mode";
