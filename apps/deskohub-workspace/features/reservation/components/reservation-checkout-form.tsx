"use client";

import type { FormEvent, ReactNode } from "react";
import type { FieldPath, FieldValues, UseFormReturn } from "react-hook-form";
import type { CheckoutSessionId } from "@/features/checkout/checkout-identifiers";
import type { CheckoutStatusSummaryPresentation } from "@/features/checkout/checkout-status-summary-presentation";
import type { CheckoutSummaryDiscount } from "@/features/checkout/checkout-summary";
import { CheckoutPayPageSkeleton } from "@/features/checkout/components/checkout-pay-page-skeleton";
import type { WorkspaceMoney } from "@/features/checkout/workspace-money";
import { type Locale, m } from "@/features/i18n";
import type { ReservationBillingSelectionInput } from "@/features/reservation/reservation-billing";
import type {
  ReservationCheckoutCustomerForm,
  ReservationContactValues,
} from "@/features/reservation/reservation-existing-customer";
import type { ReservationOrderIssuanceData } from "@/features/reservation/reservation-order";
import { Form } from "@/shared/components/ui/form";
import { ReservationBillingFields } from "./reservation-billing-fields";
import {
  confirmReservationContactEmail,
  ReservationContactHint,
  ReservationCustomerSection,
  useReservationCustomer,
} from "./reservation-customer-fields";
import { ReservationFormCard } from "./reservation-form-card";
import { ReservationFormSale } from "./reservation-form-sale";
import { ReservationMarketingConsentField } from "./reservation-marketing-consent-field";
import { ReservationPrivacyNotice } from "./reservation-privacy-notice";
import { ReservationSelectionSummary } from "./reservation-selection-summary";
import { ReservationSubmitSection } from "./reservation-submit-section";
import { useCheckoutEmailVerification } from "./use-checkout-email-verification";
import { useReservationCheckout } from "./use-reservation-checkout";
import { useReservationCheckoutStep } from "./use-reservation-checkout-step";

type ReservationFormData = FieldValues &
  ReservationContactValues & {
    readonly billing: ReservationBillingSelectionInput;
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
    /** The selection's advertised total, with the price before discounts. */
    readonly total?: {
      readonly amount: WorkspaceMoney;
      readonly originalAmount?: WorkspaceMoney;
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
  readonly checkoutCustomer: ReservationCheckoutCustomerForm;
  readonly checkoutSessionId?: CheckoutSessionId;
  readonly children: ReactNode;
  readonly form: UseFormReturn<Input, unknown, Data>;
  readonly getReservation: (data: Data) => ReservationOrderIssuanceData;
  readonly locale: Locale;
  /** The space picked at the first step, summarized at the contact step. */
  readonly selectionSummary: CheckoutStatusSummaryPresentation;
};

/**
 * The fields of the contact-details step. Every other field belongs to the
 * space picked at the first step.
 */
const contactStepFieldNames: ReadonlySet<string> = new Set([
  "address",
  "billing",
  "email",
  "emailConfirmation",
  "marketingConsent",
  "name",
  "phone",
]);

export function ReservationCheckoutForm<
  Input extends FieldValues,
  Data extends ReservationFormData,
>({
  advertisedPrice,
  availability,
  checkoutCustomer,
  checkoutSessionId,
  children,
  form,
  getReservation,
  locale,
  selectionSummary,
}: ReservationCheckoutFormProps<Input, Data>) {
  const checkoutStep = useReservationCheckoutStep();
  const existingCustomer =
    checkoutCustomer.status === "linked"
      ? checkoutCustomer.existingCustomer
      : undefined;
  const customer = useReservationCustomer(existingCustomer);
  const booksForSomeoneElse = Boolean(
    existingCustomer && customer.mode === "contact"
  );
  // Consent belongs to the account's own Dotypos customer, so the account
  // card asks only until it is given, and someone else's contact never.
  const asksMarketingConsent = existingCustomer
    ? customer.mode === "account" && !existingCustomer.hasMarketingConsent
    : true;
  const emailVerification = useCheckoutEmailVerification({ locale });
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
        emailVerification.clearError();
        if (
          booksForSomeoneElse &&
          !confirmReservationContactEmail(form, locale)
        ) {
          capturePrePaymentOutcome("validation");
          return;
        }
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

        if (checkoutCustomer.status === "signed-out") {
          emailVerification.verify({
            name: data.name,
            email: data.email,
            phone: data.phone,
            billing: data.billing,
            marketingConsent: data.marketingConsent,
          });
          return;
        }

        startCheckout({
          advertisedPriceToken: advertisedPrice.token,
          ...(!booksForSomeoneElse && { customer: "account" }),
          marketingConsent: asksMarketingConsent && data.marketingConsent,
          reservation: getReservation(data),
        });
      },
      (errors) => {
        if (booksForSomeoneElse) confirmReservationContactEmail(form, locale);
        capturePrePaymentOutcome("validation");
        // A selection that went stale since the first step is fixed there.
        if (
          Object.keys(errors).some((name) => !contactStepFieldNames.has(name))
        ) {
          checkoutStep.goTo("selection");
        }
      }
    )(event);
  };

  const continueToContact = async () => {
    clearSubmissionError();
    const selectionFieldNames = Object.keys(form.getValues()).filter(
      (name) => !contactStepFieldNames.has(name)
    ) as FieldPath<Input>[];
    if (!(await form.trigger(selectionFieldNames, { shouldFocus: true }))) {
      capturePrePaymentOutcome("validation");
      return;
    }
    if (availability.unavailableMessage) {
      capturePrePaymentOutcome("availability_changed");
      setSubmissionError(availability.unavailableMessage);
      return;
    }
    checkoutStep.goTo("contact");
  };
  const isContactStep = checkoutStep.step === "contact";

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
          {/* Both steps stay mounted, so going back keeps what was typed. */}
          <div className="space-y-7" hidden={isContactStep}>
            {children}
          </div>
          <div className="space-y-7" hidden={!isContactStep}>
            <ReservationSelectionSummary
              locale={locale}
              onChange={() => checkoutStep.goTo("selection")}
              summary={selectionSummary}
              total={advertisedPrice.total}
            />
            <ReservationCustomerSection
              checkoutCustomer={checkoutCustomer}
              customer={customer}
              locale={locale}
            />
            <ReservationBillingFields locale={locale} />
            <ReservationPrivacyNotice locale={locale} />
            {asksMarketingConsent && (
              <ReservationMarketingConsentField locale={locale} />
            )}
            {checkoutCustomer.status === "signed-out" && (
              <ReservationContactHint>
                {m.reservationContactVerificationHint({}, { locale })}
              </ReservationContactHint>
            )}
          </div>
          <ReservationSubmitSection
            disabled={
              form.formState.isSubmitting ||
              (isContactStep && checkoutCustomer.status === "unavailable") ||
              isSubmittingCheckout ||
              emailVerification.isVerifying ||
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
            onContinue={
              isContactStep ? undefined : () => void continueToContact()
            }
            onRetryPrice={advertisedPrice.retry}
            priceError={advertisedPrice.isError}
            retryingPrice={advertisedPrice.isFetching}
            submissionError={submissionError ?? emailVerification.error}
            unavailableMessage={availability.unavailableMessage}
          />
        </form>
      </Form>
    </ReservationFormCard>
  );
}
