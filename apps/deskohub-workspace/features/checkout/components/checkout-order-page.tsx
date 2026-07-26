import { type ReactNode, Suspense } from "react";
import type { Locale } from "@/features/i18n";
import { CheckoutFlowLayout } from "./checkout-flow-layout";

type CheckoutOrderPageProps = {
  readonly children: ReactNode;
  readonly fallback: ReactNode;
  readonly locale: Locale;
};

export function CheckoutOrderPage({
  children,
  fallback,
  locale,
}: CheckoutOrderPageProps) {
  return (
    <CheckoutFlowLayout activeStepKey="order" locale={locale}>
      {/* Suspense isolates useSearchParams() hydration, not data fetching or lazy loading. */}
      <Suspense fallback={fallback}>{children}</Suspense>
    </CheckoutFlowLayout>
  );
}
