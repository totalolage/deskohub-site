"use client";

import { Data, Effect } from "effect";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { authClient } from "@/features/account/auth.client";
import { type Locale, m } from "@/features/i18n";
import { runWorkspaceBrowserEffectUntilAbort } from "@/shared/browser/workspace-browser-effect";
import { reportWorkspaceBrowserFailure } from "@/shared/browser/workspace-browser-logs";
import { Button } from "@/shared/components/ui/button";

type ConsentPhase =
  | "idle"
  | "submitting"
  | "navigating"
  /** The signed request expired or was altered; only the assistant can start a new one. */
  | "expired"
  | "failed";

/** The OAuth server returned no redirect URL, or could not be reached. */
class CustomerAgentConsentError extends Data.TaggedError(
  "CustomerAgentConsentError"
)<{ readonly status?: number; readonly cause?: unknown }> {}

/**
 * Sends the customer's answer and yields the assistant's redirect URL. An
 * accepted consent always names the scopes it grants; the server refuses one
 * that doesn't.
 */
const submitConsent = (accept: boolean, scope: string) =>
  Effect.tryPromise({
    try: () =>
      authClient.oauth2.consent(accept ? { accept, scope } : { accept }),
    catch: (cause) => new CustomerAgentConsentError({ cause }),
  }).pipe(
    Effect.flatMap(({ data, error }) =>
      data?.url
        ? Effect.succeed(data.url)
        : Effect.fail(
            new CustomerAgentConsentError({
              status: error?.status,
              cause: error,
            })
          )
    )
  );

const consentFailureCode = "account.customer-agent-consent.failed";

/**
 * Allow and Deny on the consent step. The OAuth server answers both with the
 * assistant's redirect URL, which this page then opens.
 */
export function CustomerAgentConsentActions({
  locale,
  clientName,
  scope,
}: {
  readonly locale: Locale;
  readonly clientName: string;
  /** The space-separated scopes Allow grants. */
  readonly scope: string;
}) {
  const [phase, setPhase] = useState<ConsentPhase>("idle");
  const [answer, setAnswer] = useState<boolean>();
  // Leaving the page drops a pending answer, so a late reply can't navigate.
  const lifetime = useRef<AbortSignal>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller.signal;
    return () => controller.abort();
  }, []);

  const respond = (accept: boolean) => {
    if (lifetime.current === undefined) return;
    setAnswer(accept);
    setPhase("submitting");
    void submitConsent(accept, scope).pipe(
      Effect.flatMap((url) =>
        Effect.sync(() => {
          setPhase("navigating");
          window.location.assign(url);
        })
      ),
      Effect.catch((error) =>
        // 400: the signed request expired or was altered.
        error.status === 400
          ? Effect.sync(() => setPhase("expired"))
          : reportWorkspaceBrowserFailure(consentFailureCode, error).pipe(
              Effect.andThen(Effect.sync(() => setPhase("failed")))
            )
      ),
      runWorkspaceBrowserEffectUntilAbort(
        "account.customer-agent-consent.submit",
        lifetime.current
      )
    );
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
