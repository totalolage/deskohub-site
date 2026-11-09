import type { GoogleConsentState } from "../utils/google-consent-mode";

declare global {
  type GtagConsentCommand = "default" | "update";

  interface Window {
    dataLayer?: unknown[];
    gtag?: (
      command: "consent",
      action: GtagConsentCommand,
      params: Partial<GoogleConsentState>
    ) => void;
  }
}
