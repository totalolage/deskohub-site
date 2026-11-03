"use client";

import { useEffect } from "react";
import * as CookieConsent from "vanilla-cookieconsent";
import "vanilla-cookieconsent/dist/cookieconsent.css";
import type { Locale } from "@/features/i18n";
import type { ConsentCategory } from "@/shared/utils/consent-cookie";
import { createConsentConfig } from "../config/consent-config";
import {
  type GoogleConsentUpdateOptions,
  setGoogleConsentDefaults,
  updateGoogleConsentMode,
} from "../utils/google-consent-mode";
import {
  announceVisitorConsentChange,
  onVisitorConsentSaved,
  visitorConsent,
} from "../visitor-consent";

type ConsentBannerProps = {
  locale: Locale;
};

/**
 * Runs the vanilla-cookieconsent banner and preferences modal, and applies
 * each saved consent to Google consent mode before announcing it.
 */
export function ConsentBanner({ locale }: ConsentBannerProps) {
  useEffect(() => {
    setGoogleConsentDefaults();
    const stopApplyingSavedConsent = onVisitorConsentSaved(applyConsent);

    CookieConsent.run({
      ...createConsentConfig(locale),
      onFirstConsent: () => applyConsent({ announceToTagManager: true }),
      onConsent: () => applyConsent({ announceToTagManager: false }),
      onChange: () => applyConsent({ announceToTagManager: true }),
    });

    applyConsent({ announceToTagManager: false });

    // Another tab's change, or one found on focus, reaches Google consent
    // mode here too, so a withdrawal elsewhere stops this tab's tags. This
    // neither re-announces nor queues consent_update.
    const stopFollowingConsent = visitorConsent.subscribe(() => {
      const accepted = visitorConsent.acceptedCategories();
      if (appliedCategories === accepted.join(",")) return;
      applyGoogleConsent(accepted, { announceToTagManager: false });
    });

    return () => {
      stopFollowingConsent();
      stopApplyingSavedConsent();
    };
  }, [locale]);

  return null;
}

// The accepted set Google consent mode last received in this tab.
let appliedCategories: string | undefined;

// One cookie read feeds both the update and the record of what was sent, so
// another tab's write in between cannot desynchronize them.
function applyGoogleConsent(
  accepted: readonly ConsentCategory[],
  options: GoogleConsentUpdateOptions
) {
  updateGoogleConsentMode(accepted, options);
  appliedCategories = accepted.join(",");
}

// The tag manager's consent_update is queued, so the app event always fires
// first.
function applyConsent(options: GoogleConsentUpdateOptions) {
  applyGoogleConsent(visitorConsent.acceptedCategories(), options);
  announceVisitorConsentChange();
}
