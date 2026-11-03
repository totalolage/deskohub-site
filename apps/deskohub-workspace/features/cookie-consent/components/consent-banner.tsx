"use client";

import { useEffect } from "react";
import * as CookieConsent from "vanilla-cookieconsent";
import "vanilla-cookieconsent/dist/cookieconsent.css";
import type { Locale } from "@/features/i18n";
import { consentCategories } from "@/shared/utils/consent-cookie";
import { createConsentConfig } from "../config/consent-config";
import {
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
      if (appliedCategories === acceptedCategoriesKey()) return;
      updateGoogleConsentMode(visitorConsent.accepts, {
        announceToTagManager: false,
      });
      appliedCategories = acceptedCategoriesKey();
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

const acceptedCategoriesKey = () =>
  consentCategories.filter(visitorConsent.accepts).join(",");

// The tag manager's consent_update is queued, so the app event always fires
// first.
function applyConsent(options: { readonly announceToTagManager: boolean }) {
  updateGoogleConsentMode(visitorConsent.accepts, options);
  appliedCategories = acceptedCategoriesKey();
  announceVisitorConsentChange();
}
