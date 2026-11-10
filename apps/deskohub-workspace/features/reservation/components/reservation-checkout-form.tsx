"use client";

import { type ReactNode, useEffect, useRef } from "react";
import type {
  FieldValues,
  Path,
  PathValue,
  UseFormReturn,
} from "react-hook-form";
import { usePrepareReservationSiteTool } from "@/features/agent-tools/webmcp/use-prepare-reservation-site-tool";
import type { CheckoutSessionId } from "@/features/checkout/checkout-identifiers";
import type { CheckoutStatusSummaryPresentation } from "@/features/checkout/checkout-status-summary-presentation";
import type { CheckoutSummaryDiscount } from "@/features/checkout/checkout-summary";
import { CheckoutPayPageSkeleton } from "@/features/checkout/components/checkout-pay-page-skeleton";
import { type Locale, m } from "@/features/i18n";
import type { ReservationCheckoutCustomerForm } from "@/features/reservation/reservation-existing-customer";
import type {
  ReservationOrderData,
  ReservationOrderIssuanceData,
} from "@/features/reservation/reservation-order";
import { Form } from "@/shared/components/ui/form";
import type { Money } from "@/shared/money/money";
import { ReservationBillingFields } from "./reservation-billing-fields";
import {
  continueReservationToContact,
  isReservationSubmitDisabled,
  type ReservationFormData,
  type ReservationFormSubmission,
  type ReservationSubmitOptions,
  submitReservationForm,
} from "./reservation-checkout-form-submission";
import {
  ReservationContactHint,
  type ReservationCustomer,
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

export type { ReservationFormSubmission } from "./reservation-checkout-form-submission";

/** The selected option's advertised price, as checkout submits and shows it. */
export type ReservationCheckoutAdvertisedPrice = {
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
    readonly amount: Money;
    readonly originalAmount?: Money;
  };
};

type ReservationCheckoutFormProps<
  Input extends FieldValues,
  Data extends ReservationFormData,
> = {
  readonly advertisedPrice: ReservationCheckoutAdvertisedPrice;
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
  /** The family the form books, and its selection values from link parameters. */
  readonly selection: {
    readonly kind: ReservationOrderData["kind"];
    readonly fromSearchParams: (
      searchParams: URLSearchParams
    ) => Partial<Input>;
  };
};

/**
 * Who the form books for: the account, or someone else's contact, and
 * whether it asks for the account's marketing consent.
 */
function useReservationFormCustomer(
  checkoutCustomer: ReservationCheckoutCustomerForm
) {
  const existingCustomer =
    checkoutCustomer.status === "linked" ||
    checkoutCustomer.status === "review-account"
      ? checkoutCustomer.existingCustomer
      : undefined;
  const customer = useReservationCustomer(existingCustomer);
  return {
    // Consent belongs to the account's own Dotypos customer, so the account
    // card asks only until it is given, and someone else's contact never.
    asksMarketingConsent: existingCustomer
      ? customer.mode === "account" && !existingCustomer.hasMarketingConsent
      : true,
    booksForSomeoneElse: Boolean(
      existingCustomer && customer.mode === "contact"
    ),
    customer,
  };
}

/** Lets the site tool fill and submit the form as the customer would. */
function useReservationFormSiteTool<Input extends FieldValues>({
  advertisedPrice,
  asksMarketingConsent,
  availability,
  form,
  locale,
  selection,
  submit,
}: {
  readonly advertisedPrice: {
    readonly isError: boolean;
    readonly isFetching: boolean;
    readonly token?: string;
  };
  readonly asksMarketingConsent: boolean;
  readonly availability: {
    readonly isPending: boolean;
    readonly unavailableMessage?: string;
  };
  readonly form: Pick<UseFormReturn<Input>, "getValues" | "setValue">;
  readonly locale: Locale;
  readonly selection: ReservationCheckoutFormProps<
    Input,
    ReservationFormData
  >["selection"];
  readonly submit: (
    options: ReservationSubmitOptions
  ) => Promise<ReservationFormSubmission>;
}) {
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
}

/**
 * Details typed before the email verification that signed this account in
 * continue to payment on their own once the page can submit them. A failed
 * attempt leaves the filled form for the customer to retry.
 */
function useContinuedCheckout({
  checkoutCustomer,
  isContactStep,
  isSubmitDisabled,
}: {
  readonly checkoutCustomer: ReservationCheckoutCustomerForm;
  readonly isContactStep: boolean;
  readonly isSubmitDisabled: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const hasContinuedCheckout = useRef(false);
  const continuesCheckout =
    checkoutCustomer.status === "profile-missing" &&
    checkoutCustomer.continuesCheckout &&
    isContactStep;
  useEffect(() => {
    if (!continuesCheckout || isSubmitDisabled || hasContinuedCheckout.current)
      return;
    hasContinuedCheckout.current = true;
    formRef.current?.requestSubmit();
  }, [continuesCheckout, isSubmitDisabled]);
  return formRef;
}

const getSaleBanner = (
  sale: ReservationCheckoutFormProps<
    FieldValues,
    ReservationFormData
  >["advertisedPrice"]["sale"],
  locale: Locale
) =>
  sale?.discounts.length ? (
    <ReservationFormSale
      discounts={sale.discounts}
      locale={locale}
      productLabel={sale.productLabel}
    />
  ) : undefined;

/** The contact-details step, after the space picked at the first step. */
function ReservationContactStep({
  asksMarketingConsent,
  checkoutCustomer,
  customer,
  isContactStep,
  locale,
  onChangeSelection,
  selectionSummary,
  total,
}: {
  readonly asksMarketingConsent: boolean;
  readonly checkoutCustomer: ReservationCheckoutCustomerForm;
  readonly customer: ReservationCustomer;
  readonly isContactStep: boolean;
  readonly locale: Locale;
  readonly onChangeSelection: () => void;
  readonly selectionSummary: CheckoutStatusSummaryPresentation;
  readonly total: ReservationCheckoutFormProps<
    FieldValues,
    ReservationFormData
  >["advertisedPrice"]["total"];
}) {
  return (
    <div className="space-y-7" hidden={!isContactStep}>
      {isContactStep && (
        <ReservationSelectionSummary
          locale={locale}
          onChange={onChangeSelection}
          summary={selectionSummary}
          total={total}
        />
      )}
      <ReservationCustomerSection
        checkoutCustomer={checkoutCustomer}
        customer={customer}
        locale={locale}
      />
      {checkoutCustomer.status !== "support-required" && (
        <>
          <ReservationBillingFields locale={locale} />
          <ReservationPrivacyNotice locale={locale} />
          {asksMarketingConsent && (
            <ReservationMarketingConsentField locale={locale} />
          )}
        </>
      )}
      {checkoutCustomer.status === "signed-out" && (
        <ReservationContactHint>
          {m.reservationContactVerificationHint({}, { locale })}
        </ReservationContactHint>
      )}
    </div>
  );
}

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
  selection,
}: ReservationCheckoutFormProps<Input, Data>) {
  const checkoutStep = useReservationCheckoutStep();
  const { asksMarketingConsent, booksForSomeoneElse, customer } =
    useReservationFormCustomer(checkoutCustomer);
  const emailVerification = useCheckoutEmailVerification({ locale });
  const checkout = useReservationCheckout({
    initialCheckoutSessionId: checkoutSessionId,
    locale,
  });
  const submission = {
    advertisedPrice,
    asksMarketingConsent,
    availability,
    booksForSomeoneElse,
    checkout,
    checkoutCustomer,
    checkoutStep,
    emailVerification,
    form,
    getReservation,
    locale,
  };
  const submit = (options?: ReservationSubmitOptions) =>
    submitReservationForm(submission, options);
  useReservationFormSiteTool({
    advertisedPrice,
    asksMarketingConsent,
    availability,
    form,
    locale,
    selection,
    submit,
  });

  const isContactStep = checkoutStep.step === "contact";
  const isSubmitDisabled = isReservationSubmitDisabled(
    submission,
    isContactStep
  );
  const formRef = useContinuedCheckout({
    checkoutCustomer,
    isContactStep,
    isSubmitDisabled,
  });

  if (checkout.isPreparingCheckout) {
    return <CheckoutPayPageSkeleton locale={locale} />;
  }

  return (
    <ReservationFormCard sale={getSaleBanner(advertisedPrice.sale, locale)}>
      <Form {...form}>
        <form
          className="space-y-7"
          noValidate
          onSubmit={(event) => {
            // The selection step's button submits too, so the date and time
            // fields can stop an entry they can't take before the step moves
            // on.
            if (isContactStep) {
              void submit({ event });
              return;
            }
            event.preventDefault();
            void continueReservationToContact(submission);
          }}
          ref={formRef}
        >
          {/* Both steps stay mounted, so going back keeps what was typed. The
              hidden selection is disabled, so its fields don't hold up the
              contact step's submission; the form's values still decide it. */}
          <fieldset
            className="min-w-0 space-y-7"
            disabled={isContactStep}
            hidden={isContactStep}
          >
            {children}
          </fieldset>
          <ReservationContactStep
            asksMarketingConsent={asksMarketingConsent}
            checkoutCustomer={checkoutCustomer}
            customer={customer}
            isContactStep={isContactStep}
            locale={locale}
            onChangeSelection={() => checkoutStep.goTo("selection")}
            selectionSummary={selectionSummary}
            total={advertisedPrice.total}
          />
          {/* Support has to sort out the account before it can book, so the
              contact step shows only what was chosen and how to reach
              support. */}
          {!(
            isContactStep && checkoutCustomer.status === "support-required"
          ) && (
            <ReservationSubmitSection
              disabled={isSubmitDisabled}
              isAvailabilityLoading={availability.isPending}
              isPriceLoading={
                advertisedPrice.isFetching && !advertisedPrice.token
              }
              locale={locale}
              continues={!isContactStep}
              onRetryPrice={advertisedPrice.retry}
              priceError={advertisedPrice.isError}
              retryingPrice={advertisedPrice.isFetching}
              submissionError={
                checkout.submissionError ?? emailVerification.error
              }
              unavailableMessage={availability.unavailableMessage}
            />
          )}
        </form>
      </Form>
    </ReservationFormCard>
  );
}
