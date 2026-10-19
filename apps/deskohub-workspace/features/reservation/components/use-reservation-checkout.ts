"use client";

import { track } from "@vercel/analytics/react";
import { useRouter, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  type CheckoutSessionId,
  createCheckoutAttemptId,
  createCheckoutSessionId,
} from "@/features/checkout/checkout-identifiers";
import { useCookieConsent } from "@/features/cookie-consent";
import { type Locale, m } from "@/features/i18n";
import { preparePayState } from "@/features/reservation/actions/prepare-pay-state";
import {
  getReservationAnalyticsProperties,
  type ReservationPrePaymentOutcome,
} from "@/features/reservation/reservation-analytics";
import type { ReservationOrderIssuanceData } from "@/features/reservation/reservation-order";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";

type ReservationCheckoutDetails = {
  readonly advertisedPriceToken: string;
  readonly customer?: "account";
  readonly marketingConsent?: boolean;
  /** Labels a `marketingConsent: true` given through a site tool. */
  readonly marketingConsentSource?: "site_tool";
  readonly reservation: ReservationOrderIssuanceData;
};

/** Where a checkout submission led: the prepared Pay page or an error message. */
export type CheckoutSubmission =
  | {
      readonly status: "ready" | "pricing_changed";
      readonly redirectUrl: string;
      /** When the Pay page stops accepting the prepared state. */
      readonly expiresAt: string;
    }
  | { readonly status: "error"; readonly message: string };

type UseReservationCheckoutOptions = {
  readonly initialCheckoutSessionId?: CheckoutSessionId;
  readonly locale: Locale;
};

export function useReservationCheckout({
  initialCheckoutSessionId,
  locale,
}: UseReservationCheckoutOptions) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAccepted } = useCookieConsent();
  const hasTrackedSuccessfulSubmission = useRef(false);
  const lastSubmittedReservationRef = useRef<string | null>(null);
  const [checkoutSessionId] = useState(
    () => initialCheckoutSessionId ?? createCheckoutSessionId()
  );
  const [checkoutAttemptId, setCheckoutAttemptId] = useState(
    createCheckoutAttemptId
  );
  const [submissionError, setSubmissionError] = useState<string>();
  const analyticsProperties = useMemo(
    () => getReservationAnalyticsProperties(searchParams),
    [searchParams]
  );
  const capturePrePaymentOutcome = useCallback(
    (outcome: ReservationPrePaymentOutcome) => {
      if (!isAccepted("analytics")) return;
      posthog.capture("pre-payment outcome", { outcome });
    },
    [isAccepted]
  );
  const {
    executeAsync: prepareCheckout,
    isExecuting,
    result,
  } = useWorkspaceAction(preparePayState, {
    actionName: "preparePayState",
    onSuccess: ({ data }) => {
      if (data?.status === "error") {
        setSubmissionError(data.message);
        return;
      }

      const redirectUrl = data?.redirectUrl;
      if (!redirectUrl) {
        setSubmissionError(m.reservationErrorMessage({}, { locale }));
        return;
      }

      if (!hasTrackedSuccessfulSubmission.current && isAccepted("analytics")) {
        hasTrackedSuccessfulSubmission.current = true;
        track("workspace_checkout_started", analyticsProperties);
      }

      router.push(redirectUrl);
    },
    onError: ({ error }) => {
      setSubmissionError(
        error.serverError || m.reservationErrorMessage({}, { locale })
      );
    },
    onTransportError: () => {
      capturePrePaymentOutcome("transport_error");
      setSubmissionError(m.reservationErrorMessage({}, { locale }));
    },
  });
  const preparedCheckout = getPreparedCheckout(result.data);
  const hasPreparedPayRedirect = preparedCheckout !== undefined;
  const failedCheckout = (message?: string): CheckoutSubmission => ({
    status: "error",
    message: message || m.reservationErrorMessage({}, { locale }),
  });

  const startCheckout = async (
    details: ReservationCheckoutDetails
  ): Promise<CheckoutSubmission> => {
    if (preparedCheckout) return preparedCheckout;

    setSubmissionError(undefined);
    hasTrackedSuccessfulSubmission.current = false;
    window.scrollTo({ top: 0, behavior: "instant" });

    const reservationFingerprint = JSON.stringify(details.reservation);
    const effectiveCheckoutAttemptId =
      lastSubmittedReservationRef.current &&
      lastSubmittedReservationRef.current !== reservationFingerprint
        ? createCheckoutAttemptId()
        : checkoutAttemptId;
    if (effectiveCheckoutAttemptId !== checkoutAttemptId) {
      setCheckoutAttemptId(effectiveCheckoutAttemptId);
    }
    lastSubmittedReservationRef.current = reservationFingerprint;

    const identifiers = {
      checkoutAttemptId: effectiveCheckoutAttemptId,
      checkoutSessionId,
      locale,
    };
    // The action callbacks above update the page; the returned submission
    // reports the same outcome to callers such as a site tool.
    return prepareCheckout({ ...details, ...identifiers }).then(
      ({ data, serverError }) =>
        data?.status === "error"
          ? failedCheckout(data.message)
          : (getPreparedCheckout(data) ?? failedCheckout(serverError)),
      () => failedCheckout()
    );
  };

  return {
    capturePrePaymentOutcome,
    clearSubmissionError: () => setSubmissionError(undefined),
    hasPreparedPayRedirect,
    isPreparingCheckout: isExecuting || hasPreparedPayRedirect,
    preparedCheckout,
    isSubmittingCheckout: isExecuting,
    setSubmissionError,
    startCheckout,
    submissionError,
  };
}

const getPreparedCheckout = (
  data:
    | {
        readonly status: string;
        readonly redirectUrl?: string;
        readonly expiresAt?: string;
      }
    | undefined
): CheckoutSubmission | undefined =>
  (data?.status === "ready" || data?.status === "pricing_changed") &&
  data.redirectUrl &&
  data.expiresAt
    ? {
        status: data.status,
        redirectUrl: data.redirectUrl,
        expiresAt: data.expiresAt,
      }
    : undefined;
