import type { BillingScreenCopy } from "@/features/account/components/billing/billing-screen";
import type { LegalScreenStrings } from "@/features/account/components/legal/legal-screen";
import type { ProfileScreenCopy } from "@/features/account/components/profile/profile-screen";
import type { ReservationHistoryCopy } from "@/features/account/components/reservation-history";
import type { AccountShellProps } from "@/features/account/components/shell/account-shell";
import { type Locale, m } from "@/features/i18n";

export function getAccountScreenCopy(locale: Locale) {
  return {
    shell: {
      navigation: m.accountNavigationLabel({}, { locale }),
      mobileSection: m.accountSectionLabel({}, { locale }),
      sections: {
        reservations: m.accountSectionReservations({}, { locale }),
        profile: m.accountSectionProfile({}, { locale }),
        billing: m.accountSectionBilling({}, { locale }),
        legal: m.accountSectionLegal({}, { locale }),
        danger: m.accountSectionDanger({}, { locale }),
      },
    } satisfies AccountShellProps["labels"],
    profile: {
      title: m.accountProfileScreenTitle({}, { locale }),
      memberFallback: m.accountProfileScreenMemberFallback({}, { locale }),
      verifiedEmail: m.accountProfileScreenVerifiedEmail({}, { locale }),
      emailLabel: m.accountProfileEmailLabel({}, { locale }),
      avatarUnavailableLabel: m.accountProfileScreenAvatarUnavailableLabel(
        {},
        { locale }
      ),
      avatarUnavailableDescription:
        m.accountProfileScreenAvatarUnavailableDescription({}, { locale }),
      languageLabel: m.accountProfileScreenLanguageLabel({}, { locale }),
      languageUnavailableValue: m.accountProfileScreenLanguageUnavailableValue(
        {},
        { locale }
      ),
      languageUnavailableDescription:
        m.accountProfileScreenLanguageUnavailableDescription({}, { locale }),
    } satisfies ProfileScreenCopy,
    billing: {
      title: m.accountSectionBilling({}, { locale }),
      currency: m.accountBillingCurrency({}, { locale }),
      paymentMethodsTitle: m.accountBillingPaymentMethodsTitle({}, { locale }),
      paymentMethodsUnavailable: m.accountBillingPaymentMethodsUnavailable(
        {},
        { locale }
      ),
      addPaymentCard: m.accountBillingAddPaymentCard({}, { locale }),
      removePaymentCard: m.accountBillingRemovePaymentCard({}, { locale }),
      billingDetailsTitle: m.accountBillingDetailsTitle({}, { locale }),
      syncAres: m.accountBillingSyncAres({}, { locale }),
      aresUnavailable: m.accountBillingAresUnavailable({}, { locale }),
      invoiceHistoryTitle: m.accountBillingInvoiceHistoryTitle({}, { locale }),
      invoiceHistoryUnavailable: m.accountBillingInvoiceHistoryUnavailable(
        {},
        { locale }
      ),
      downloadInvoice: m.accountBillingDownloadInvoice({}, { locale }),
      exportInvoices: m.accountBillingExportInvoices({}, { locale }),
    } satisfies BillingScreenCopy,
    legal: {
      title: m.accountLegalTitle({}, { locale }),
      analyticsTitle: m.accountLegalAnalyticsTitle({}, { locale }),
      analyticsDescription: m.accountLegalAnalyticsDescription({}, { locale }),
      marketingTitle: m.accountLegalMarketingTitle({}, { locale }),
      marketingDescription: m.accountLegalMarketingDescription({}, { locale }),
      preferencesUnavailable: m.accountLegalPreferencesUnavailable(
        {},
        { locale }
      ),
      unavailable: m.accountFeatureUnavailable({}, { locale }),
      archiveTitle: m.accountLegalArchiveTitle({}, { locale }),
      archiveDescription: m.accountLegalArchiveDescription({}, { locale }),
      archiveAction: m.accountLegalArchiveAction({}, { locale }),
      savePreferences: m.accountLegalSavePreferences({}, { locale }),
    } satisfies LegalScreenStrings,
    reservations: {
      assignedDesk: m.accountReservationAssignedDesk({}, { locale }),
      checkIn: m.accountReservationCheckIn({}, { locale }),
      date: m.accountReservationDate({}, { locale }),
      moreCurrent: m.accountReservationMoreCurrent({}, { locale }),
      nfcAccess: m.accountReservationNfcAccess({}, { locale }),
      product: m.accountReservationProduct({}, { locale }),
      seats: m.accountReservationSeatsLabel({}, { locale }),
      showPinCode: m.accountReservationShowPinCode({}, { locale }),
      status: m.accountReservationStatus({}, { locale }),
      unavailable: m.accountFeatureUnavailable({}, { locale }),
      unsupportedDescription: m.accountFeatureUnavailableDescription(
        {},
        { locale }
      ),
      validity: m.accountReservationValidity({}, { locale }),
      viewReservation: m.accountReservationView({}, { locale }),
      wifi: m.accountReservationWifi({}, { locale }),
    } satisfies ReservationHistoryCopy,
    dangerTitle: m.accountSectionDanger({}, { locale }),
  };
}
