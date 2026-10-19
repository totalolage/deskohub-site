"use client";

import { type Locale, m } from "@/features/i18n";
import { Skeleton } from "@/shared/components/ui/skeleton";
import {
  CheckoutPayCard,
  CheckoutPayConsent,
  CheckoutPayProviderHandoff,
  CheckoutPaySubmitButton,
} from "./checkout-pay-page-card";
import {
  CheckoutSummarySection,
  CheckoutSummarySections,
} from "./checkout-summary-section";

export function CheckoutPayPageSkeleton({
  locale,
}: {
  readonly locale: Locale;
}) {
  return (
    <CheckoutPayCard
      aria-busy="true"
      aria-label={m.checkoutPaymentRetryPending({}, { locale })}
      aria-live="polite"
      role="status"
      title={m.checkoutPayTitle({}, { locale })}
    >
      <CheckoutPaySummarySkeleton locale={locale} />
      <CheckoutPayProviderHandoff locale={locale} />
      <CheckoutPayConsent
        disabled
        id="checkout-pay-skeleton-legal-consent"
        locale={locale}
        variant="pay"
      />
      <CheckoutPaySubmitButton disabled locale={locale} variant="pay" />
    </CheckoutPayCard>
  );
}

function CheckoutPaySummarySkeleton({ locale }: { readonly locale: Locale }) {
  return (
    <CheckoutSummarySections>
      <CheckoutSummarySection locale={locale} sectionKey="order">
        <Skeleton aria-hidden="true" className="h-4 w-full rounded-full" />
        <Skeleton aria-hidden="true" className="h-4 w-11/12 rounded-full" />
        <Skeleton aria-hidden="true" className="h-4 w-4/5 rounded-full" />
      </CheckoutSummarySection>

      <CheckoutSummarySection locale={locale} sectionKey="total">
        <div className="flex items-start justify-between gap-4">
          <Skeleton aria-hidden="true" className="h-4 w-32 rounded-full" />
          <Skeleton aria-hidden="true" className="h-4 w-24 rounded-full" />
        </div>
      </CheckoutSummarySection>
    </CheckoutSummarySections>
  );
}
