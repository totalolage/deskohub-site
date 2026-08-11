"use client";

import { track } from "@vercel/analytics/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import {
  type CheckoutSessionId,
  createCheckoutAttemptId,
  createCheckoutSessionId,
} from "@/features/checkout/checkout-identifiers";
import { useCookieConsent } from "@/features/cookie-consent";
import { type Locale, m } from "@/features/i18n";
import { preparePayState } from "@/features/reservation/actions/prepare-pay-state";
import { getReservationAnalyticsProperties } from "@/features/reservation/reservation-analytics";
import type { ReservationOrderData } from "@/features/reservation/reservation-order";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";

type ReservationCheckoutDetails = {
  readonly advertisedPriceToken: string;
  readonly marketingConsent?: boolean;
  readonly reservation: ReservationOrderData;
};

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
  const {
    execute: prepareCheckout,
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
      setSubmissionError(m.reservationErrorMessage({}, { locale }));
    },
  });
  const hasPreparedPayRedirect =
    (result.data?.status === "ready" ||
      result.data?.status === "pricing_changed") &&
    Boolean(result.data.redirectUrl);

  const startCheckout = (details: ReservationCheckoutDetails) => {
    if (hasPreparedPayRedirect) return;

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
    prepareCheckout({ ...details, ...identifiers });
  };

  return {
    clearSubmissionError: () => setSubmissionError(undefined),
    hasPreparedPayRedirect,
    isPreparingCheckout: isExecuting || hasPreparedPayRedirect,
    isSubmittingCheckout: isExecuting,
    setSubmissionError,
    startCheckout,
    submissionError,
  };
}
