import { type Locale, m } from "@/features/i18n";

export interface MarketingPreferencesFormCopy {
  readonly rowTitle: string;
  readonly rowDescription: string;
  readonly savingStatus: string;
  readonly accountContext: string;
  readonly linkContext: string;
  readonly statusActive: string;
  readonly statusWithdrawn: string;
  readonly grantConfirmation: string;
  readonly withdrawConfirmation: string;
  readonly grantAction: string;
  readonly withdrawAction: string;
  readonly saved: string;
  readonly saveError: string;
  readonly pendingDescription: string;
  readonly continueAction: string;
  readonly confirming: string;
  readonly confirmed: string;
  readonly confirmError: string;
  readonly clearAction: string;
  readonly clearing: string;
  readonly cleared: string;
  readonly clearError: string;
  readonly unavailableDescription: string;
  readonly unavailableNextStep: string;
  readonly unavailableSignInNextStep: string;
  readonly signInAction: string;
  readonly invalidLinkDescription: string;
  readonly invalidLinkNextStep: string;
}

// The Inlang catalogs are the source of truth; this module only shapes the
// per-locale strings for the injectable copy prop and its consumers.
export const getMarketingPreferencesFormCopy = (
  locale: Locale
): MarketingPreferencesFormCopy => ({
  rowTitle: m.marketingPreferencesFormRowTitle({}, { locale }),
  rowDescription: m.marketingPreferencesFormRowDescription({}, { locale }),
  savingStatus: m.marketingPreferencesFormSavingStatus({}, { locale }),
  accountContext: m.marketingPreferencesFormAccountContext({}, { locale }),
  linkContext: m.marketingPreferencesFormLinkContext({}, { locale }),
  statusActive: m.marketingPreferencesFormStatusActive({}, { locale }),
  statusWithdrawn: m.marketingPreferencesFormStatusWithdrawn({}, { locale }),
  grantConfirmation: m.marketingPreferencesFormGrantConfirmation(
    {},
    { locale }
  ),
  withdrawConfirmation: m.marketingPreferencesFormWithdrawConfirmation(
    {},
    { locale }
  ),
  grantAction: m.marketingPreferencesFormGrantAction({}, { locale }),
  withdrawAction: m.marketingPreferencesFormWithdrawAction({}, { locale }),
  saved: m.marketingPreferencesFormSaved({}, { locale }),
  saveError: m.marketingPreferencesFormSaveError({}, { locale }),
  pendingDescription: m.marketingPreferencesFormPendingDescription(
    {},
    { locale }
  ),
  continueAction: m.marketingPreferencesFormContinueAction({}, { locale }),
  confirming: m.marketingPreferencesFormConfirming({}, { locale }),
  confirmed: m.marketingPreferencesFormConfirmed({}, { locale }),
  confirmError: m.marketingPreferencesFormConfirmError({}, { locale }),
  clearAction: m.marketingPreferencesFormClearAction({}, { locale }),
  clearing: m.marketingPreferencesFormClearing({}, { locale }),
  cleared: m.marketingPreferencesFormCleared({}, { locale }),
  clearError: m.marketingPreferencesFormClearError({}, { locale }),
  unavailableDescription: m.marketingPreferencesFormUnavailableDescription(
    {},
    { locale }
  ),
  unavailableNextStep: m.marketingPreferencesFormUnavailableNextStep(
    {},
    { locale }
  ),
  unavailableSignInNextStep:
    m.marketingPreferencesFormUnavailableSignInNextStep({}, { locale }),
  signInAction: m.marketingPreferencesFormSignInAction({}, { locale }),
  invalidLinkDescription: m.marketingPreferencesFormInvalidLinkDescription(
    {},
    { locale }
  ),
  invalidLinkNextStep: m.marketingPreferencesFormInvalidLinkNextStep(
    {},
    { locale }
  ),
});

export const marketingPreferencesFormCopy = {
  "en-US": getMarketingPreferencesFormCopy("en-US"),
  "cs-CZ": getMarketingPreferencesFormCopy("cs-CZ"),
} satisfies Readonly<Record<Locale, MarketingPreferencesFormCopy>>;
