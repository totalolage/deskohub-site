"use client";

import type { FormEvent, ReactNode } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";
import { CheckoutPayPageSkeleton } from "@/features/checkout/components/checkout-pay-page";
import { type Locale, m } from "@/features/i18n";
import type { ReservationOrderData } from "@/features/reservation/reservation-order";
import { Form } from "@/shared/components/ui/form";
import { ReservationCustomerFields } from "./reservation-customer-fields";
import { ReservationFormCard } from "./reservation-form-card";
import { ReservationLegalConsentField } from "./reservation-legal-consent-field";
import { ReservationSubmitSection } from "./reservation-submit-section";
import { useReservationCheckout } from "./use-reservation-checkout";

type ReservationFormData = FieldValues & {
  readonly legalConsent: boolean;
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
  };
  readonly availability: {
    readonly isFetching: boolean;
    readonly unavailableMessage?: string;
  };
  readonly afterCustomerFields?: ReactNode;
  readonly checkoutSessionId?: string;
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
    void form.handleSubmit((data) => {
      if (hasPreparedPayRedirect) return;

      clearSubmissionError();
      if (availability.unavailableMessage) {
        setSubmissionError(availability.unavailableMessage);
        return;
      }
      if (!advertisedPrice.token) {
        setSubmissionError(m.reservationErrorMessage({}, { locale }));
        return;
      }

      startCheckout({
        advertisedPriceToken: advertisedPrice.token,
        legalConsent: data.legalConsent,
        reservation: getReservation(data),
      });
    })(event);
  };

  if (isPreparingCheckout) {
    return <CheckoutPayPageSkeleton locale={locale} />;
  }

  return (
    <ReservationFormCard>
      <Form {...form}>
        <form className="space-y-7" onSubmit={handleSubmit}>
          {children}
          <ReservationCustomerFields
            locale={locale}
            messagePlaceholder={messagePlaceholder}
          />
          {afterCustomerFields}
          <ReservationLegalConsentField locale={locale} />
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
