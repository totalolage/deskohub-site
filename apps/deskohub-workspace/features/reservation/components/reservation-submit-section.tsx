"use client";

import { AlertTriangle, ArrowRight } from "lucide-react";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";

type ReservationSubmitSectionProps = {
  readonly disabled: boolean;
  readonly isAvailabilityLoading: boolean;
  readonly isPriceLoading: boolean;
  readonly locale: Locale;
  /** Continues to the next step instead of submitting the form. */
  readonly onContinue?: () => void;
  readonly onRetryPrice: () => void;
  readonly priceError: boolean;
  readonly retryingPrice: boolean;
  readonly submissionError?: string;
  readonly unavailableMessage?: string;
};

export function ReservationSubmitSection({
  disabled,
  isAvailabilityLoading,
  isPriceLoading,
  locale,
  onContinue,
  onRetryPrice,
  priceError,
  retryingPrice,
  submissionError,
  unavailableMessage,
}: ReservationSubmitSectionProps) {
  return (
    <div className="space-y-3 pt-1">
      <Button
        size="xl"
        caps
        fullWidth
        data-reservation-availability-loading={isAvailabilityLoading}
        data-reservation-price-error={priceError}
        data-reservation-price-loading={isPriceLoading}
        data-reservation-unavailable={Boolean(unavailableMessage)}
        disabled={disabled}
        id={onContinue ? "reservation-continue" : "reservation-submit"}
        onClick={onContinue}
        type={onContinue ? "button" : "submit"}
      >
        <ArrowRight className="h-4 w-4" />
        {m.checkoutContinueButton({}, { locale })}
      </Button>

      {submissionError && (
        <ReservationError role="alert">{submissionError}</ReservationError>
      )}
      {unavailableMessage && !submissionError && (
        <ReservationError>{unavailableMessage}</ReservationError>
      )}
      {isAvailabilityLoading && !submissionError && (
        <ReservationLoadingMessage>
          {m.reservationAvailabilityLoading({}, { locale })}
        </ReservationLoadingMessage>
      )}
      {isPriceLoading && !submissionError && (
        <ReservationLoadingMessage>
          {m.reservationAdvertisedPriceLoading({}, { locale })}
        </ReservationLoadingMessage>
      )}
      {priceError && !submissionError && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-burned-orange/20 bg-burned-orange/8 px-4 py-3 text-sm leading-6 text-burned-orange-ink"
          role="alert"
        >
          <span className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-burned-orange" />
            <span>{m.reservationAdvertisedPriceError({}, { locale })}</span>
          </span>
          <Button
            size="sm"
            pending={retryingPrice}
            id="reservation-advertised-price-retry"
            onClick={onRetryPrice}
            type="button"
            variant="secondary"
          >
            {m.reservationAdvertisedPriceRetry({}, { locale })}
          </Button>
        </div>
      )}
    </div>
  );
}

function ReservationError({
  children,
  role,
}: {
  readonly children: string;
  readonly role?: "alert";
}) {
  return (
    <p
      // A failed submission remounts the form with its error, so it needs an
      // alert role: a live region mounted with its text may go unannounced.
      {...(role ? { role } : { "aria-live": "polite" as const })}
      className="flex items-start gap-2 rounded-2xl border border-burned-orange/20 bg-burned-orange/8 px-4 py-3 text-sm leading-6 text-burned-orange-ink"
    >
      <AlertTriangle
        aria-hidden="true"
        className="mt-0.5 h-4 w-4 shrink-0 text-burned-orange"
      />
      <span>{children}</span>
    </p>
  );
}

function ReservationLoadingMessage({
  children,
}: {
  readonly children: string;
}) {
  return (
    <p aria-live="polite" className="text-sm leading-6 text-navy-blue/62">
      {children}
    </p>
  );
}
