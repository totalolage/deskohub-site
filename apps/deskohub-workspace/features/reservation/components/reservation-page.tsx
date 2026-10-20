import { type ReactNode, Suspense } from "react";
import {
  CheckoutFlowLayout,
  CheckoutSteps,
} from "@/features/checkout/components/checkout-flow-layout";
import type { Locale } from "@/features/i18n";
import { QueryProvider } from "@/shared/components/query-provider";
import { ReservationCheckoutSteps } from "./reservation-checkout-steps";

type ReservationPageProps = {
  readonly children: ReactNode;
  readonly fallback: ReactNode;
  readonly locale: Locale;
  readonly title: string;
};

export function ReservationPage({
  children,
  fallback,
  locale,
  title,
}: ReservationPageProps) {
  return (
    <CheckoutFlowLayout
      activeStepKey="chooseSpace"
      locale={locale}
      steps={
        // The step lives in the URL, which the prerendered shell can't read.
        <Suspense
          fallback={
            <CheckoutSteps activeStepKey="chooseSpace" locale={locale} />
          }
        >
          <ReservationCheckoutSteps locale={locale} />
        </Suspense>
      }
    >
      <h1 className="sr-only">{title}</h1>
      <Suspense fallback={fallback}>
        <QueryProvider>{children}</QueryProvider>
      </Suspense>
    </CheckoutFlowLayout>
  );
}
