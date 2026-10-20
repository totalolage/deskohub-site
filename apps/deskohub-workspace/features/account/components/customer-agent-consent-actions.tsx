"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { authClient } from "@/features/account/auth.client";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";

type ConsentPhase =
  | "idle"
  | "submitting"
  | "navigating"
  /** The signed request expired or was altered; only the assistant can start a new one. */
  | "expired"
  | "failed";

/**
 * Allow and Deny on the consent step. The OAuth server answers both with the
 * assistant's redirect URL, which this page then opens.
 */
export function CustomerAgentConsentActions({
  locale,
  clientName,
}: {
  readonly locale: Locale;
  readonly clientName: string;
}) {
  const [phase, setPhase] = useState<ConsentPhase>("idle");
  const [answer, setAnswer] = useState<boolean>();

  const respond = async (accept: boolean) => {
    setAnswer(accept);
    setPhase("submitting");
    const { data, error } = await authClient.oauth2.consent({ accept }).then(
      (response) => response,
      () => ({ data: null, error: { status: 0 } })
    );
    if (!data?.url) {
      setPhase(error?.status === 400 ? "expired" : "failed");
      return;
    }
    setPhase("navigating");
    window.location.assign(data.url);
  };

  const busy = phase === "submitting" || phase === "navigating";

  return (
    <>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row-reverse">
        <Button
          className="sm:flex-1"
          disabled={busy || phase === "expired"}
          onClick={() => respond(true)}
          type="button"
        >
          {busy && answer === true && (
            <Loader2 aria-hidden="true" className="animate-spin" />
          )}
          {m.customerAgentConsentAllow({}, { locale })}
        </Button>
        <Button
          className="sm:flex-1"
          disabled={busy || phase === "expired"}
          onClick={() => respond(false)}
          type="button"
          variant="secondary"
        >
          {busy && answer === false && (
            <Loader2 aria-hidden="true" className="animate-spin" />
          )}
          {m.customerAgentConsentDeny({}, { locale })}
        </Button>
      </div>
      <p className="mt-4 text-sm text-navy-blue/68" role="status">
        {phase === "submitting" &&
          m.customerAgentConsentSubmitting({}, { locale })}
        {phase === "navigating" &&
          m.customerAgentConsentReturning({ client: clientName }, { locale })}
      </p>
      <p className="mt-2 text-sm text-red-700" role="alert">
        {phase === "expired" && m.customerAgentConsentExpired({}, { locale })}
        {phase === "failed" && m.customerAgentConsentFailed({}, { locale })}
      </p>
    </>
  );
}
