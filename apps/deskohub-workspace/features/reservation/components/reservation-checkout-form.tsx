"use client";

import { type FormEvent, type ReactNode, useEffect, useRef } from "react";
import type {
  FieldPath,
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
import type { WorkspaceMoney } from "@/features/checkout/workspace-money";
import { type Locale, m } from "@/features/i18n";
import type { ReservationBillingSelectionInput } from "@/features/reservation/reservation-billing";
import type {
  ReservationCheckoutCustomerForm,
  ReservationContactValues,
} from "@/features/reservation/reservation-existing-customer";
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
import {
  type CheckoutSubmission,
  useReservationCheckout,
} from "./use-reservation-checkout";
import { useReservationCheckoutStep } from "./use-reservation-checkout-step";

type ReservationFormData = FieldValues &
  ReservationContactValues & {
    readonly billing: ReservationBillingSelectionInput;
    readonly marketingConsent: boolean;
  };

/** Where a submission of the form led. */
export type ReservationFormSubmission =
  | CheckoutSubmission
  | {
      readonly status: "invalid";
      readonly fields: readonly InvalidFormField[];
    }
  /**
   * A signed-out customer was sent the sign-in email; checkout continues
   * once they verify it.
   */
  | { readonly status: "email-verification" };

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
  /** The family the form books, and its selection values from link parameters. */
  readonly selection: {
    readonly kind: ReservationOrderData["kind"];
    readonly fromSearchParams: (
      searchParams: URLSearchParams
    ) => Partial<Input>;
  };
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
  selection,
}: ReservationCheckoutFormProps<Input, Data>) {
  const checkoutStep = useReservationCheckoutStep();
  const existingCustomer =
    checkoutCustomer.status === "linked" ||
    checkoutCustomer.status === "review-account"
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
  ): ReservationFormSubmission | Promise<CheckoutSubmission> => {
    if (preparedCheckout) return preparedCheckout;

    clearSubmissionError();
    emailVerification.clearError();
    if (booksForSomeoneElse && !confirmReservationContactEmail(form, locale)) {
      capturePrePaymentOutcome("validation");
      return {
        status: "invalid",
        fields: [
          {
            name: "emailConfirmation",
            message: m.contactValidationEmailConfirmationMismatch(
              {},
              { locale }
            ),
          },
        ],
      };
    }
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

    if (checkoutCustomer.status === "signed-out") {
      emailVerification.verify({
        name: data.name,
        email: data.email,
        phone: data.phone,
        billing: data.billing,
        marketingConsent: data.marketingConsent,
      });
      return { status: "email-verification" };
    }

    return startCheckout({
      advertisedPriceToken: advertisedPrice.token,
      ...(!booksForSomeoneElse && { customer: "account" }),
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
        if (booksForSomeoneElse) confirmReservationContactEmail(form, locale);
        capturePrePaymentOutcome("validation");
        submission = {
          status: "invalid",
          fields: getInvalidFormFields(errors),
        };
        // A selection that went stale since the first step is fixed there.
        if (
          Object.keys(errors).some((name) => !contactStepFieldNames.has(name))
        ) {
          checkoutStep.goTo("selection");
        }
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
  // Support has to sort out the account before it can book, so the contact
  // step shows only what was chosen and how to reach support.
  const isSupportRequired = checkoutCustomer.status === "support-required";
  const isSubmitDisabled =
    form.formState.isSubmitting ||
    (isContactStep &&
      (checkoutCustomer.status === "unavailable" || isSupportRequired)) ||
    isSubmittingCheckout ||
    emailVerification.isVerifying ||
    hasPreparedPayRedirect ||
    Boolean(availability.unavailableMessage) ||
    availability.isPending ||
    advertisedPrice.isFetching ||
    // A failed refresh keeps the previous, possibly expired, token.
    advertisedPrice.isError ||
    !advertisedPrice.token;

  // Details typed before the email verification that signed this account in
  // continue to payment on their own once the page can submit them. A failed
  // attempt leaves the filled form for the customer to retry.
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
        <form
          className="space-y-7"
          noValidate
          onSubmit={handleSubmit}
          ref={formRef}
        >
          {/* Both steps stay mounted, so going back keeps what was typed. */}
          <div className="space-y-7" hidden={isContactStep}>
            {children}
          </div>
          <div className="space-y-7" hidden={!isContactStep}>
            {isContactStep && (
              <ReservationSelectionSummary
                locale={locale}
                onChange={() => checkoutStep.goTo("selection")}
                summary={selectionSummary}
                total={advertisedPrice.total}
              />
            )}
            <ReservationCustomerSection
              checkoutCustomer={checkoutCustomer}
              customer={customer}
              locale={locale}
            />
            {!isSupportRequired && (
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
          {!(isContactStep && isSupportRequired) && (
            <ReservationSubmitSection
              disabled={isSubmitDisabled}
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
          )}
        </form>
      </Form>
    </ReservationFormCard>
  );
}
