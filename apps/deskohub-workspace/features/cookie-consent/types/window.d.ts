import type { ConsentState } from "../utils/consent-mode";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (
      command: string,
      action: string,
      params: Partial<ConsentState>
    ) => void;
  }
}
