import { Suspense } from "react";
import type { Locale } from "@/features/i18n";
import {
  ReservationForm,
  ReservationFormFallback,
} from "@/features/reservation/components/reservation-form";
import {
  coworkReservationDefaultValues,
  getCoworkTierRequiresMonitorOption,
} from "@/features/reservation/cowork-reservation";
import { CheckoutFlowLayout } from "./checkout-flow-layout";

type CheckoutOrderPageProps = {
  locale: Locale;
};

export function CheckoutOrderPage({ locale }: CheckoutOrderPageProps) {
  const showMonitorOptionFallback = getCoworkTierRequiresMonitorOption(
    coworkReservationDefaultValues.entryTier
  );

  return (
    <CheckoutFlowLayout activeStepKey="order" locale={locale}>
      {/* Suspense isolates useSearchParams() hydration, not data fetching or lazy loading. */}
      <Suspense
        fallback={
          <ReservationFormFallback
            locale={locale}
            showMonitorOption={showMonitorOptionFallback}
          />
        }
      >
        <ReservationForm locale={locale} />
      </Suspense>
    </CheckoutFlowLayout>
  );
}
