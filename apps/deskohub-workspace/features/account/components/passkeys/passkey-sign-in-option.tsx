"use client";

import { KeyRound, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { signInWithPasskey } from "@/features/account/passkey-client";
import { type Locale, m } from "@/features/i18n";
import { supportsPasskeyAutofill } from "@/shared/browser/webauthn-capabilities";
import { Button } from "@/shared/components/ui/button";

type PasskeySignInOptionProps = {
  readonly locale: Locale;
  /** Where to continue after sign-in; validated before use. */
  readonly returnTo?: string;
  readonly ready: boolean;
};

/**
 * The sign-in card's explicit passkey entry below the email form. While it is
 * mounted, the email field above also offers saved passkeys in its autofill.
 */
export function PasskeySignInOption({
  locale,
  returnTo,
  ready,
}: PasskeySignInOptionProps) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  // An autofill request waits until the customer picks a passkey. The
  // button's attempt cancels it, and it starts again once that attempt
  // settles. Its failures stay quiet: the customer never asked for it, and
  // hosts that can't run passkey ceremonies reject it.
  useEffect(() => {
    if (pending) return;
    const autofill = new AbortController();
    void supportsPasskeyAutofill().then((supported) => {
      if (!supported) return;
      void signInWithPasskey({
        locale,
        returnTo,
        autoFill: true,
        signal: autofill.signal,
      });
    });
    return () => autofill.abort();
  }, [locale, returnTo, pending]);

  // A button attempt continues to the destination it started for. Another
  // destination, or unmounting the option, cancels it.
  const destination = useRef<{
    readonly locale: Locale;
    readonly returnTo?: string;
    readonly signal: AbortSignal;
  }>(undefined);
  useEffect(() => {
    const lifetime = new AbortController();
    destination.current = { locale, returnTo, signal: lifetime.signal };
    return () => lifetime.abort();
  }, [locale, returnTo]);

  const signIn = async () => {
    if (destination.current === undefined) return;
    setFailed(false);
    setPending(true);
    const result = await signInWithPasskey(destination.current);
    if (result === "signed-in") return;
    setPending(false);
    setFailed(result === "failed");
  };

  return (
    <div className="mt-2">
      <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.2em] text-navy-blue/45">
        <span aria-hidden className="h-px flex-1 bg-navy-blue/12" />
        {m.accountAuthMethodDivider({}, { locale })}
        <span aria-hidden className="h-px flex-1 bg-navy-blue/12" />
      </div>
      <Button
        className="mt-4"
        disabled={!ready || pending}
        fullWidth
        id="account-sign-in-passkey"
        onClick={signIn}
        type="button"
        variant="secondary"
      >
        {pending ? (
          <Loader2 aria-hidden className="size-4 animate-spin" />
        ) : (
          <KeyRound aria-hidden className="size-4" />
        )}
        {pending
          ? m.accountSignInPasskeyPending({}, { locale })
          : m.accountSignInPasskey({}, { locale })}
      </Button>
      <div aria-live="polite" className="mt-3 min-h-5 text-sm text-red-700">
        {failed && m.accountSignInPasskeyFailed({}, { locale })}
      </div>
    </div>
  );
}
