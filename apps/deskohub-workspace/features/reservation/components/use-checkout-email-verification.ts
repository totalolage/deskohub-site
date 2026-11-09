"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { startEmailSignIn } from "@/features/account/auth-return";
import { signInEmailFailureMessage } from "@/features/account/components/sign-in-email-failure-message";
import { getAuthVerifyPath } from "@/features/account/routes";
import { type Locale, m } from "@/features/i18n";
import { sealCheckoutContact } from "@/features/reservation/actions/seal-checkout-contact";
import { checkoutContactQueryParam } from "@/features/reservation/reservation-checkout-contact";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";

/**
 * This page with its current selection and the sealed contact details, where
 * the sign-in lands once the email is verified.
 */
const getCheckoutContactReturnPath = (token: string) => {
  const url = new URL(window.location.href);
  url.searchParams.set(checkoutContactQueryParam, token);
  return `${url.pathname}${url.search}`;
};

/**
 * Verifies a signed-out customer's email before checkout: seals the typed
 * contact details into the sign-in's return path, sends the sign-in email,
 * and opens the verify modal over the form.
 */
export function useCheckoutEmailVerification({
  locale,
}: {
  readonly locale: Locale;
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const seal = useWorkspaceAction(sealCheckoutContact, {
    onSuccess: async ({ data, input }) => {
      if (!data) {
        setError(m.reservationErrorMessage({}, { locale }));
        return;
      }

      setIsSendingEmail(true);
      const result = await startEmailSignIn({
        locale,
        email: input.email,
        returnTo: getCheckoutContactReturnPath(data.token),
      }).finally(() => setIsSendingEmail(false));
      // A review login continues to its password on the verify page.
      if (result.status === "sent" || result.status === "password") {
        router.push(getAuthVerifyPath(locale), { scroll: false });
        return;
      }
      if (result.status === "failed") {
        setError(signInEmailFailureMessage(result.reason, locale));
      }
    },
    onError: () => setError(m.reservationErrorMessage({}, { locale })),
  });

  return {
    clearError: () => setError(undefined),
    error,
    isVerifying: seal.isExecuting || isSendingEmail,
    verify: (contact: Parameters<typeof seal.execute>[0]) => {
      setError(undefined);
      seal.execute(contact);
    },
  };
}
