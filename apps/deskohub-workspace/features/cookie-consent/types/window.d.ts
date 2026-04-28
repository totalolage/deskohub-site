import type { ConsentState } from "../utils/consent-mode";

declare global {
  type GtagConsentCommand = "default" | "update";

  interface Window {
    dataLayer?: unknown[];
    gtag?: (
      command: "consent",
      action: GtagConsentCommand,
      params: Partial<ConsentState>
    ) => void;
  }
}
