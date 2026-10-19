"use client";

import type { FormEvent, ReactNode } from "react";
import type {
  FieldValues,
  Path,
  PathValue,
  UseFormReturn,
} from "react-hook-form";
import { usePrepareReservationSiteTool } from "@/features/agent-tools/webmcp/use-prepare-reservation-site-tool";
import type { CheckoutSessionId } from "@/features/checkout/checkout-identifiers";
import type { CheckoutSummaryDiscount } from "@/features/checkout/checkout-summary";
import { CheckoutPayPageSkeleton } from "@/features/checkout/components/checkout-pay-page-skeleton";
import { type Locale, m } from "@/features/i18n";
import type { ReservationExistingCustomerForm } from "@/features/reservation/reservation-existing-customer";
import type {
  ReservationOrderData,
  ReservationOrderIssuanceData,
} from "@/features/reservation/reservation-order";
import { Form } from "@/shared/components/ui/form";
import {
  getInvalidFormFields,
  type InvalidFormField,
} from "@/shared/utils/form-field-errors";
import { ReservationBillingFields } from "./reservation-billing-fields";
import {
  ReservationCustomerSection,
  useReservationCustomer,
} from "./reservation-customer-fields";
import { ReservationFormCard } from "./reservation-form-card";
import { ReservationFormSale } from "./reservation-form-sale";
import { ReservationMarketingConsentField } from "./reservation-marketing-consent-field";
import { ReservationPrivacyNotice } from "./reservation-privacy-notice";
import { ReservationSubmitSection } from "./reservation-submit-section";
import {
  type CheckoutSubmission,
  useReservationCheckout,
} from "./use-reservation-checkout";

type ReservationFormData = FieldValues & {
  readonly marketingConsent: boolean;
};

/** Where a submission of the form led. */
export type ReservationFormSubmission =
  | CheckoutSubmission
  | {
      readonly status: "invalid";
      readonly fields: readonly InvalidFormField[];
    };

type ReservationSubmitOptions = {
  readonly event?: FormEvent<HTMLFormElement>;
  /** Labels a marketing consent the site tool ticked for the customer. */
  readonly marketingConsentSource?: "site_tool";
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
    /**
     * Whether availability for the current selection has not settled yet. A
     * background refetch of settled availability is not pending: submission
     * re-checks availability authoritatively.
     */
    readonly isPending: boolean;
    readonly unavailableMessage?: string;
  };
  readonly checkoutSessionId?: CheckoutSessionId;
  readonly children: ReactNode;
  /** The signed-in customer the form can book as, if any. */
  readonly existingCustomer?: ReservationExistingCustomerForm;
  readonly form: UseFormReturn<Input, unknown, Data>;
  readonly getReservation: (data: Data) => ReservationOrderIssuanceData;
  readonly locale: Locale;
  /** The family the form books, and its selection values from link parameters. */
  readonly selection: {
    readonly kind: ReservationOrderData["kind"];
    readonly fromSearchParams: (
      searchParams: URLSearchParams
    ) => Partial<Input>;
  };
};

export function ReservationCheckoutForm<
  Input extends FieldValues,
  Data extends ReservationFormData,
>({
  advertisedPrice,
  availability,
  checkoutSessionId,
  children,
  existingCustomer,
  form,
  getReservation,
  locale,
  selection,
}: ReservationCheckoutFormProps<Input, Data>) {
  const customer = useReservationCustomer(existingCustomer);
  // Consent belongs to the Dotypos customer being booked, so only the account
  // card knows it is already given; another contact is always asked.
  const asksMarketingConsent = !(
    existingCustomer?.hasMarketingConsent && customer.mode === "account"
  );
  const {
    capturePrePaymentOutcome,
    clearSubmissionError,
    hasPreparedPayRedirect,
    preparedCheckout,
    isPreparingCheckout,
    isSubmittingCheckout,
    setSubmissionError,
    startCheckout,
    submissionError,
  } = useReservationCheckout({
    initialCheckoutSessionId: checkoutSessionId,
    locale,
  });

  const checkout = (
    data: Data,
    marketingConsentSource: "site_tool" | undefined
  ): CheckoutSubmission | Promise<CheckoutSubmission> => {
    if (preparedCheckout) return preparedCheckout;

    clearSubmissionError();
    if (availability.unavailableMessage) {
      capturePrePaymentOutcome("availability_changed");
      setSubmissionError(availability.unavailableMessage);
      return { status: "error", message: availability.unavailableMessage };
    }
    if (!advertisedPrice.token) {
      capturePrePaymentOutcome("transport_error");
      const message = m.reservationErrorMessage({}, { locale });
      setSubmissionError(message);
      return { status: "error", message };
    }

    return startCheckout({
      advertisedPriceToken: advertisedPrice.token,
      ...(existingCustomer &&
        customer.mode === "account" && { customer: "account" }),
      // Without the checkbox the account already consented: send no consent.
      ...(asksMarketingConsent && {
        marketingConsent: data.marketingConsent,
        ...(data.marketingConsent &&
          marketingConsentSource && { marketingConsentSource }),
      }),
      reservation: getReservation(data),
    });
  };

  // The submit button and the site tool share this path: validation, the
  // availability and price checks, then checkout.
  const submit = async ({
    event,
    marketingConsentSource,
  }: ReservationSubmitOptions = {}): Promise<ReservationFormSubmission> => {
    let submission: ReservationFormSubmission | Promise<CheckoutSubmission> = {
      status: "invalid",
      fields: [],
    };
    await form.handleSubmit(
      (data) => {
        submission = checkout(data, marketingConsentSource);
      },
      (errors) => {
        capturePrePaymentOutcome("validation");
        submission = {
          status: "invalid",
          fields: getInvalidFormFields(errors),
        };
      }
    )(event);
    return submission;
  };

  const marketingConsentField = "marketingConsent" as Path<Input>;
  usePrepareReservationSiteTool({
    asksMarketingConsent,
    hasMarketingConsent: () => form.getValues(marketingConsentField) === true,
    giveMarketingConsent: () =>
      form.setValue(
        marketingConsentField,
        true as PathValue<Input, Path<Input>>,
        { shouldDirty: true, shouldTouch: true }
      ),
    applySelection: (searchParams) => {
      let changed = false;
      for (const [name, value] of Object.entries(
        selection.fromSearchParams(searchParams)
      )) {
        const field = name as Path<Input>;
        if (Object.is(form.getValues(field), value)) continue;
        form.setValue(field, value, {
          shouldDirty: true,
          shouldValidate: true,
        });
        changed = true;
      }
      return changed;
    },
    kind: selection.kind,
    locale,
    readiness: {
      isPending:
        availability.isPending ||
        advertisedPrice.isFetching ||
        (!advertisedPrice.token && !advertisedPrice.isError),
      priceError: advertisedPrice.isError,
      unavailableMessage: availability.unavailableMessage,
    },
    submit: (marketingConsentSource) => submit({ marketingConsentSource }),
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    void submit({ event });
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
          <ReservationCustomerSection
            customer={customer}
            existingCustomer={existingCustomer}
            locale={locale}
          />
          <ReservationBillingFields locale={locale} />
          <ReservationPrivacyNotice locale={locale} />
          {asksMarketingConsent && (
            <ReservationMarketingConsentField locale={locale} />
          )}
          <ReservationSubmitSection
            disabled={
              form.formState.isSubmitting ||
              isSubmittingCheckout ||
              hasPreparedPayRedirect ||
              Boolean(availability.unavailableMessage) ||
              availability.isPending ||
              advertisedPrice.isFetching ||
              // A failed refresh keeps the previous, possibly expired, token.
              advertisedPrice.isError ||
              !advertisedPrice.token
            }
            isAvailabilityLoading={availability.isPending}
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
