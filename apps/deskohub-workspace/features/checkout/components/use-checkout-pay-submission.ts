"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { markCheckoutStatusWindowOwner } from "@/features/checkout/components/checkout-payment-window";
import { type Locale, m } from "@/features/i18n";
import { submitReservation } from "@/features/reservation/actions/submit-reservation";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";

type SubmittedReservation = NonNullable<
  Awaited<ReturnType<typeof submitReservation>>
>["data"];

/**
 * Opens the payment gateway in a new tab whose status page this tab owns.
 * Returns false when the browser didn't open the tab.
 */
const openCheckoutPaymentWindow = (redirectUrl: string, statusUrl: string) => {
  const paymentWindow = window.open(redirectUrl, "_blank");
  if (!paymentWindow) return false;

  paymentWindow.opener = null;
  markCheckoutStatusWindowOwner(statusUrl);
  return true;
};

/**
 * Continues a submitted reservation and returns where this tab goes next: the
 * fresh Pay page after a price change, the status page once the gateway opens
 * in a new tab, or the gateway itself. Returns undefined when the submission
 * can't continue.
 */
const continueSubmittedReservation = (
  data: SubmittedReservation
): string | undefined => {
  if (!data) return undefined;
  if (data.status === "pricing_changed") return data.freshPayUrl;
  if (data.status === "in_progress" || !data.redirectUrl) return undefined;

  return data.statusUrl &&
    openCheckoutPaymentWindow(data.redirectUrl, data.statusUrl)
    ? data.statusUrl
    : data.redirectUrl;
};

/**
 * The Pay page's reservation submission: the customer's legal consent, the
 * pending state while the checkout starts or redirects, and the error the
 * page shows when it can't.
 */
export function useCheckoutPaySubmission({
  earlyPerformanceRequestRequired,
  locale,
  payStateToken,
}: {
  readonly earlyPerformanceRequestRequired: boolean;
  readonly locale: Locale;
  readonly payStateToken: string | undefined;
}) {
  const router = useRouter();
  const [legalConsent, setLegalConsent] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const showSubmitError = () =>
    setErrorMessage(m.checkoutPaySubmitError({}, { locale }));
  const { execute, isExecuting, result } = useWorkspaceAction(
    submitReservation,
    {
      onSuccess: ({ data }) => {
        const nextUrl = continueSubmittedReservation(data);
        if (nextUrl === undefined) {
          showSubmitError();
          return;
        }
        router.push(nextUrl);
      },
      onError: ({ error }) => {
        setErrorMessage(
          error.serverError || m.checkoutPaySubmitError({}, { locale })
        );
      },
      onTransportError: showSubmitError,
    }
  );
  const hasCheckoutRedirect =
    result.data?.status === "pricing_changed" ||
    result.data?.status === "redirect";
  const isSubmitPending = isExecuting || hasCheckoutRedirect;

  const submit = () => {
    if (isSubmitPending) return;

    setErrorMessage(null);
    if (!payStateToken) {
      showSubmitError();
      return;
    }

    const input = {
      locale,
      payStateToken,
      legalConsent,
    };
    execute(
      earlyPerformanceRequestRequired
        ? { ...input, earlyPerformanceConsent: legalConsent }
        : input
    );
  };

  return {
    errorMessage,
    isSubmitPending,
    legalConsent,
    setLegalConsent,
    submit,
  };
}
