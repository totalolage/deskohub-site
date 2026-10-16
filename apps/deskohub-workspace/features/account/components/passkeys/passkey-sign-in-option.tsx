"use client";

import { KeyRound, Loader2 } from "lucide-react";
import { useState } from "react";
import type { PasskeySignInResult } from "@/features/account/passkeys";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";

type PasskeySignInOptionProps = {
  readonly locale: Locale;
  readonly ready: boolean;
  readonly signInWithPasskey: () => Promise<PasskeySignInResult>;
};

/** The sign-in card's explicit passkey entry below the email form. */
export function PasskeySignInOption({
  locale,
  ready,
  signInWithPasskey,
}: PasskeySignInOptionProps) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const signIn = async () => {
    setFailed(false);
    setPending(true);
    const result = await signInWithPasskey();
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
