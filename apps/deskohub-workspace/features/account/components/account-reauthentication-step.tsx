"use client";

import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type {
  AuthReturnLifecycle,
  SignInEmailFailure,
} from "@/features/account/auth-return";
import { SignInCodeStep } from "@/features/account/components/sign-in-code-step";
import { signInEmailFailureMessage } from "@/features/account/components/sign-in-email-failure-message";
import type { PasskeyConfirmationResult } from "@/features/account/passkeys";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { cn, maskEmailAddress } from "@/shared/utils";

/** The sensitive change a stale session must confirm before it proceeds. */
type AccountReauthenticationPurpose = "delete-account" | "add-passkey";

type AccountReauthenticationStepProps = {
  readonly purpose: AccountReauthenticationPurpose;
  readonly email: string;
  readonly locale: Locale;
  readonly authReturn: AuthReturnLifecycle;
  /**
   * Whether `login_passkeys` is on, which gives the step its passkey-era
   * presentation. Adding a passkey implies it.
   */
  readonly passkeysEnabled?: boolean;
  /**
   * Confirms with one of the account's own passkeys. Absent when the account
   * has none or `login_passkeys` is off.
   */
  readonly confirmWithPasskey?: () => Promise<PasskeyConfirmationResult>;
  /** Runs once a typed code or a passkey has created a fresh session. */
  readonly onReauthenticated: () => void;
};

type PasskeyStatus = "idle" | "pending" | "wrong-account" | "failed";

/**
 * A dialog's re-authentication step: confirm with a passkey, or send a fresh
 * magic link and, when the email also carries a code, type it in place.
 */
export function AccountReauthenticationStep({
  purpose,
  email,
  locale,
  authReturn,
  passkeysEnabled = false,
  confirmWithPasskey,
  onReauthenticated,
}: AccountReauthenticationStepProps) {
  const [linkSent, setLinkSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<SignInEmailFailure | null>(null);
  const [codeRequestedAt, setCodeRequestedAt] = useState<number | null>(null);
  const [passkeyStatus, setPasskeyStatus] = useState<PasskeyStatus>("idle");
  const copy = {
    "delete-account": {
      descriptionId: "delete-account-dialog-description",
      statusId: "delete-account-reauth-status",
      sendId: "delete-account-reauth-send",
      title: m.accountDeletionReauthTitle({}, { locale }),
      body: confirmWithPasskey
        ? m.accountDeletionReauthPasskeyBody({}, { locale })
        : m.accountDeletionReauthBody({}, { locale }),
      codeTitle: m.accountDeletionReauthCodeTitle({}, { locale }),
      verified: m.accountDeletionReauthCodeVerified({}, { locale }),
      linkSent: m.accountDeletionReauthLinkSent({}, { locale }),
    },
    "add-passkey": {
      descriptionId: "add-passkey-dialog-description",
      statusId: "add-passkey-reauth-status",
      sendId: "add-passkey-reauth-send",
      title: m.accountPasskeyReauthTitle({}, { locale }),
      body: m.accountPasskeyReauthBody({}, { locale }),
      codeTitle: m.accountPasskeyReauthTitle({}, { locale }),
      verified: m.accountPasskeyReauthVerified({}, { locale }),
      linkSent: m.accountPasskeyReauthLinkSent({}, { locale }),
    },
  }[purpose];

  // A code-carrying email opens the code step in place. Without a code, as
  // when codes are switched off between two emails, only the link signs in.
  const sendReauthEmail = async () => {
    const result = await authReturn.sendSignInEmail(email);
    if (result.status !== "sent") {
      return result.status === "failed" ? result.reason : result.status;
    }
    setCodeRequestedAt(result.signInCode ? Date.now() : null);
    setLinkSent(!result.signInCode);
    return result.status;
  };

  const requestReauthLink = async () => {
    setFailure(null);
    setPasskeyStatus("idle");
    setSending(true);
    const outcome = await sendReauthEmail();
    setFailure(outcome === "sent" || outcome === "cancelled" ? null : outcome);
    setSending(false);
  };

  const confirmPasskey = async () => {
    if (!confirmWithPasskey) return;
    setFailure(null);
    setPasskeyStatus("pending");
    const result = await confirmWithPasskey();
    if (result === "confirmed") {
      onReauthenticated();
      return;
    }
    setPasskeyStatus(result === "cancelled" ? "idle" : result);
  };

  const codeStep = codeRequestedAt !== null;
  const iconHeader = purpose === "add-passkey" || passkeysEnabled;
  const passkeyPending = passkeyStatus === "pending";
  const passkeyFailure =
    passkeyStatus === "wrong-account" || passkeyStatus === "failed"
      ? passkeyStatus
      : null;

  // The announcement region stays mounted across both steps, so the link-only
  // fallback after a resend is announced.
  return (
    <>
      {codeStep && (
        <>
          <DialogHeader>
            <DialogTitle>{copy.codeTitle}</DialogTitle>
            <DialogDescription id={copy.descriptionId}>
              {m.accountSignInCodeBody(
                { email: maskEmailAddress(email) },
                { locale }
              )}
            </DialogDescription>
          </DialogHeader>
          <SignInCodeStep
            locale={locale}
            requestedAt={codeRequestedAt}
            verifiedMessage={copy.verified}
            verifyCode={(code) => authReturn.verifySignInCode(email, code)}
            onVerified={onReauthenticated}
            requestNewEmail={sendReauthEmail}
          />
        </>
      )}
      {!codeStep && iconHeader && (
        // The title says it all; the reason stays for screen readers.
        <DialogHeader className="justify-items-center pt-2 text-center">
          <span className="flex size-16 items-center justify-center rounded-2xl bg-[radial-gradient(circle_at_30%_20%,rgba(236,164,35,0.28),transparent_60%),radial-gradient(circle_at_80%_90%,rgba(0,223,153,0.2),transparent_55%)] bg-[#f4f3ef] text-burned-orange">
            <ShieldCheck aria-hidden className="size-8" strokeWidth={1.75} />
          </span>
          <DialogTitle className="mt-2 pr-0 text-2xl">{copy.title}</DialogTitle>
          <DialogDescription className="sr-only" id={copy.descriptionId}>
            {copy.body}
          </DialogDescription>
        </DialogHeader>
      )}
      {!codeStep && !iconHeader && (
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription id={copy.descriptionId}>
            {copy.body}
          </DialogDescription>
        </DialogHeader>
      )}
      <div
        id={copy.statusId}
        aria-live={failure || passkeyFailure ? "assertive" : "polite"}
        className={cn(
          "text-sm text-navy-blue/78",
          !codeStep && "mt-4 min-h-5 empty:mt-0 empty:min-h-0"
        )}
        role={failure || passkeyFailure ? "alert" : undefined}
      >
        {failure && signInEmailFailureMessage(failure, locale)}
        {passkeyFailure &&
          {
            "wrong-account": m.accountReauthPasskeyWrongAccount({}, { locale }),
            failed: m.accountReauthPasskeyFailed({}, { locale }),
          }[passkeyFailure]}
        {!failure && !passkeyFailure && linkSent && copy.linkSent}
      </div>
      {!codeStep && (
        // The options stack full-width under the centred header, so long
        // labels never overflow.
        <DialogFooter className={cn(iconHeader && "sm:flex-col-reverse")}>
          <Button
            id={copy.sendId}
            wrap
            type="button"
            variant={confirmWithPasskey ? "secondary" : undefined}
            disabled={sending || linkSent || passkeyPending}
            onClick={requestReauthLink}
          >
            {m.accountReauthSendEmail({}, { locale })}
          </Button>
          {confirmWithPasskey && (
            <Button
              id={`${purpose}-reauth-passkey`}
              wrap
              type="button"
              disabled={sending || passkeyPending}
              onClick={confirmPasskey}
            >
              {passkeyPending ? (
                <Loader2 aria-hidden className="size-4 animate-spin" />
              ) : (
                <KeyRound aria-hidden className="size-4" />
              )}
              {passkeyPending
                ? m.accountReauthPasskeyPending({}, { locale })
                : m.accountReauthPasskey({}, { locale })}
            </Button>
          )}
        </DialogFooter>
      )}
    </>
  );
}
