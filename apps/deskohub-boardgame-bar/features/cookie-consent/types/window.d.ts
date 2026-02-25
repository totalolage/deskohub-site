/**
 * Window type augmentation for Google Tag Manager and Consent Mode
 */

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
