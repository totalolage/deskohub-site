import { Suspense } from "react";
import type { Locale } from "@/features/i18n";
import {
  ReservationForm,
  ReservationFormFallback,
} from "@/features/reservation/components/reservation-form";
import { tierRequiresMonitorOption } from "@/features/reservation/schemas/reservation";
import { getReservationDefaultValuesFromSearchParams } from "@/features/reservation/schemas/reservation-checkout-query";
import type { SupportedSearchParams } from "@/shared/utils";
import { CheckoutFlowLayout } from "./checkout-flow-layout";

type CheckoutOrderPageProps = {
  locale: Locale;
  searchParams: SupportedSearchParams;
};

export function CheckoutOrderPage({
  locale,
  searchParams,
}: CheckoutOrderPageProps) {
  const fallbackDefaultValues =
    getReservationDefaultValuesFromSearchParams(searchParams);
  const showMonitorOptionFallback = tierRequiresMonitorOption(
    fallbackDefaultValues.entryTier
  );

  return (
    <CheckoutFlowLayout activeStepKey="order" locale={locale}>
      {/* Suspense isolates useSearchParams() hydration, not data fetching or lazy loading. */}
      <Suspense
        fallback={
          <ReservationFormFallback
            locale={locale}
            showIntro={false}
            showMonitorOption={showMonitorOptionFallback}
          />
        }
      >
        <ReservationForm locale={locale} showIntro={false} />
      </Suspense>
    </CheckoutFlowLayout>
  );
}
