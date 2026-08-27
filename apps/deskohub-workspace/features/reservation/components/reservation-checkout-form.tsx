"use client";

import type { FormEvent, ReactNode } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";
import type { CheckoutSessionId } from "@/features/checkout/checkout-identifiers";
import type { CheckoutSummaryDiscount } from "@/features/checkout/checkout-summary";
import { CheckoutPayPageSkeleton } from "@/features/checkout/components/checkout-pay-page";
import { type Locale, m } from "@/features/i18n";
import type { ReservationOrderData } from "@/features/reservation/reservation-order";
import { Form } from "@/shared/components/ui/form";
import { ReservationBillingFields } from "./reservation-billing-fields";
import { ReservationCustomerFields } from "./reservation-customer-fields";
import { ReservationFormCard } from "./reservation-form-card";
import { ReservationFormSale } from "./reservation-form-sale";
import { ReservationMarketingConsentField } from "./reservation-marketing-consent-field";
import { ReservationPrivacyNotice } from "./reservation-privacy-notice";
import { ReservationSubmitSection } from "./reservation-submit-section";
import { useReservationCheckout } from "./use-reservation-checkout";

type ReservationFormData = FieldValues & {
  readonly marketingConsent: boolean;
};

type ReservationCheckoutFormProps<
  Input extends FieldValues,
  Data extends ReservationFormData,
> = {
  readonly advertisedPrice: {
    readonly isError: boolean;
    readonly isFetching: boolean;
    readonly retry: () => void;
    readonly token?: string;
    readonly sale?: {
      readonly discounts: readonly CheckoutSummaryDiscount[];
      readonly productLabel: string;
    };
  };
  readonly availability: {
    readonly isFetching: boolean;
    readonly unavailableMessage?: string;
  };
  readonly afterCustomerFields?: ReactNode;
  readonly checkoutSessionId?: CheckoutSessionId;
  readonly children: ReactNode;
  readonly form: UseFormReturn<Input, unknown, Data>;
  readonly getReservation: (data: Data) => ReservationOrderData;
  readonly locale: Locale;
  readonly messagePlaceholder: string;
};

export function ReservationCheckoutForm<
  Input extends FieldValues,
  Data extends ReservationFormData,
>({
  advertisedPrice,
  afterCustomerFields,
  availability,
  checkoutSessionId,
  children,
  form,
  getReservation,
  locale,
  messagePlaceholder,
}: ReservationCheckoutFormProps<Input, Data>) {
  const {
    capturePrePaymentOutcome,
    clearSubmissionError,
    hasPreparedPayRedirect,
    isPreparingCheckout,
    isSubmittingCheckout,
    setSubmissionError,
    startCheckout,
    submissionError,
  } = useReservationCheckout({
    initialCheckoutSessionId: checkoutSessionId,
    locale,
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    void form.handleSubmit(
      (data) => {
        if (hasPreparedPayRedirect) return;

        clearSubmissionError();
        if (availability.unavailableMessage) {
          capturePrePaymentOutcome("availability_changed");
          setSubmissionError(availability.unavailableMessage);
          return;
        }
        if (!advertisedPrice.token) {
          capturePrePaymentOutcome("transport_error");
          setSubmissionError(m.reservationErrorMessage({}, { locale }));
          return;
        }

        startCheckout({
          advertisedPriceToken: advertisedPrice.token,
          marketingConsent: data.marketingConsent,
          reservation: getReservation(data),
        });
      },
      () => capturePrePaymentOutcome("validation")
    )(event);
  };

  if (isPreparingCheckout) {
    return <CheckoutPayPageSkeleton locale={locale} />;
  }

  return (
    <ReservationFormCard
      sale={
        advertisedPrice.sale?.discounts.length ? (
          <ReservationFormSale
            discounts={advertisedPrice.sale.discounts}
            locale={locale}
            productLabel={advertisedPrice.sale.productLabel}
          />
        ) : undefined
      }
    >
      <Form {...form}>
        <form className="space-y-7" noValidate onSubmit={handleSubmit}>
          {children}
          <ReservationCustomerFields
            locale={locale}
            messagePlaceholder={messagePlaceholder}
          />
          <ReservationBillingFields locale={locale} />
          {afterCustomerFields}
          <ReservationPrivacyNotice locale={locale} />
          <ReservationMarketingConsentField locale={locale} />
          <ReservationSubmitSection
            disabled={
              form.formState.isSubmitting ||
              isSubmittingCheckout ||
              hasPreparedPayRedirect ||
              Boolean(availability.unavailableMessage) ||
              availability.isFetching ||
              advertisedPrice.isFetching ||
              !advertisedPrice.token
            }
            isAvailabilityLoading={availability.isFetching}
            isPriceLoading={
              advertisedPrice.isFetching && !advertisedPrice.token
            }
            locale={locale}
            onRetryPrice={advertisedPrice.retry}
            priceError={advertisedPrice.isError}
            retryingPrice={advertisedPrice.isFetching}
            submissionError={submissionError}
            unavailableMessage={availability.unavailableMessage}
          />
        </form>
      </Form>
    </ReservationFormCard>
  );
}
