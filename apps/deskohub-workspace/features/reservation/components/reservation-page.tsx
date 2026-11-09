import { type ReactNode, Suspense } from "react";
import {
  CheckoutFlowLayout,
  CheckoutSteps,
} from "@/features/checkout/components/checkout-flow-layout";
import type { Locale } from "@/features/i18n";
import {
  type PublicPageBreadcrumb,
  PublicPageBreadcrumbs,
} from "@/features/public-pages/components/public-page-breadcrumbs";
import { QueryProvider } from "@/shared/components/query-provider";
import { ReservationCheckoutSteps } from "./reservation-checkout-steps";

type ReservationPageProps = {
  /** The pages above this one, ending with it, when it has a place on the site. */
  readonly breadcrumbs?: ReadonlyArray<PublicPageBreadcrumb>;
  readonly children: ReactNode;
  readonly fallback: ReactNode;
  readonly locale: Locale;
  readonly title: string;
};

export function ReservationPage({
  breadcrumbs,
  children,
  fallback,
  locale,
  title,
}: ReservationPageProps) {
  return (
    <CheckoutFlowLayout
      activeStepKey="chooseSpace"
      breadcrumbs={
        breadcrumbs && (
          <PublicPageBreadcrumbs
            crumbs={breadcrumbs}
            locale={locale}
            tone="inverse"
          />
        )
      }
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
      <h1 className="text-4xl leading-tight text-balance sm:text-5xl">
        {title}
      </h1>
      <Suspense fallback={fallback}>
        <QueryProvider>{children}</QueryProvider>
      </Suspense>
    </CheckoutFlowLayout>
  );
}
