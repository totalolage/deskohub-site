"use client";

import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { type ComponentProps, useState } from "react";
import type {
  AuthReturnLifecycle,
  SignInEmailFailure,
} from "@/features/account/auth-return";
import { SignInCodeStep } from "@/features/account/components/sign-in-code-step";
import { signInEmailFailureMessage } from "@/features/account/components/sign-in-email-failure-message";
import { SignInPasswordForm } from "@/features/account/components/sign-in-password-form";
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
  /**
   * Runs once a typed code, a passkey, or a review login's password has
   * created a fresh session.
   */
  readonly onReauthenticated: () => void;
};

type PasskeyStatus = "idle" | "pending" | "wrong-account" | "failed";

type PasskeyFailure = Extract<PasskeyStatus, "wrong-account" | "failed">;

const passkeyFailureOf = (status: PasskeyStatus): PasskeyFailure | null =>
  status === "wrong-account" || status === "failed" ? status : null;

/** The step's element ids and copy for the change it confirms. */
const reauthenticationCopy = (
  purpose: AccountReauthenticationPurpose,
  locale: Locale,
  passkeyOffered: boolean
) =>
  ({
    "delete-account": {
      descriptionId: "delete-account-dialog-description",
      statusId: "delete-account-reauth-status",
      sendId: "delete-account-reauth-send",
      title: m.accountDeletionReauthTitle({}, { locale }),
      body: passkeyOffered
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
  })[purpose];

type ReauthenticationCopy = ReturnType<typeof reauthenticationCopy>;

/**
 * A dialog's re-authentication step: confirm with a passkey, or send a fresh
 * magic link and, when the email also carries a code, type it in place. A
 * review login's address gets no email and types its password in place.
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
  const [passwordStep, setPasswordStep] = useState(false);
  const [passkeyStatus, setPasskeyStatus] = useState<PasskeyStatus>("idle");
  const copy = reauthenticationCopy(
    purpose,
    locale,
    confirmWithPasskey !== undefined
  );

  // A code-carrying email opens the code step in place. Without a code, as
  // when codes are switched off between two emails, only the link signs in.
  const sendReauthEmail = async () => {
    const result = await authReturn.sendSignInEmail(email);
    if (result.status === "password") {
      // The password entry replaces the email steps.
      setCodeRequestedAt(null);
      setLinkSent(false);
      setPasswordStep(true);
      return "sent" as const;
    }
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

  const codeStep = codeRequestedAt !== null || passwordStep;
  const iconHeader = purpose === "add-passkey" || passkeysEnabled;

  // The announcement region stays mounted across both steps, so the link-only
  // fallback after a resend is announced.
  return (
    <>
      {passwordStep && (
        <ReauthenticationPasswordStep
          authReturn={authReturn}
          copy={copy}
          email={email}
          locale={locale}
          onReauthenticated={onReauthenticated}
        />
      )}
      {codeRequestedAt !== null && (
        <ReauthenticationCodeStep
          authReturn={authReturn}
          copy={copy}
          email={email}
          locale={locale}
          onReauthenticated={onReauthenticated}
          requestNewEmail={sendReauthEmail}
          requestedAt={codeRequestedAt}
        />
      )}
      {!codeStep && (
        <ReauthenticationOptionsHeader copy={copy} iconHeader={iconHeader} />
      )}
      <ReauthenticationStatus
        codeStep={codeStep}
        copy={copy}
        failure={failure}
        linkSent={linkSent}
        locale={locale}
        passkeyFailure={passkeyFailureOf(passkeyStatus)}
      />
      {!codeStep && (
        <ReauthenticationOptions
          copy={copy}
          iconHeader={iconHeader}
          linkSent={linkSent}
          locale={locale}
          onConfirmPasskey={confirmWithPasskey && confirmPasskey}
          onRequestLink={requestReauthLink}
          passkeyPending={passkeyStatus === "pending"}
          purpose={purpose}
          sending={sending}
        />
      )}
    </>
  );
}

type ReauthenticationEntryProps = {
  readonly authReturn: AuthReturnLifecycle;
  readonly copy: ReauthenticationCopy;
  readonly email: string;
  readonly locale: Locale;
  readonly onReauthenticated: () => void;
};

/** A review login's password entry, which replaces the email steps. */
function ReauthenticationPasswordStep({
  authReturn,
  copy,
  email,
  locale,
  onReauthenticated,
}: ReauthenticationEntryProps) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription id={copy.descriptionId}>
          {m.accountSignInPasswordBody(
            { email: maskEmailAddress(email) },
            { locale }
          )}
        </DialogDescription>
      </DialogHeader>
      <SignInPasswordForm
        locale={locale}
        email={email}
        signedInMessage={copy.verified}
        signIn={(password) => authReturn.signInWithPassword(email, password)}
        onSignedIn={onReauthenticated}
      />
    </>
  );
}

/** The emailed code's entry, opened in place once a code-carrying email is sent. */
function ReauthenticationCodeStep({
  authReturn,
  copy,
  email,
  locale,
  onReauthenticated,
  requestNewEmail,
  requestedAt,
}: ReauthenticationEntryProps & {
  readonly requestNewEmail: ComponentProps<
    typeof SignInCodeStep
  >["requestNewEmail"];
  readonly requestedAt: number;
}) {
  return (
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
        requestedAt={requestedAt}
        verifiedMessage={copy.verified}
        verifyCode={(code) => authReturn.verifySignInCode(email, code)}
        onVerified={onReauthenticated}
        requestNewEmail={requestNewEmail}
      />
    </>
  );
}

function ReauthenticationOptionsHeader({
  copy,
  iconHeader,
}: {
  readonly copy: ReauthenticationCopy;
  readonly iconHeader: boolean;
}) {
  if (!iconHeader) {
    return (
      <DialogHeader>
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription id={copy.descriptionId}>
          {copy.body}
        </DialogDescription>
      </DialogHeader>
    );
  }
  // The title says it all; the reason stays for screen readers.
  return (
    <DialogHeader className="justify-items-center pt-2 text-center">
      <span className="flex size-16 items-center justify-center rounded-2xl bg-[radial-gradient(circle_at_30%_20%,rgba(236,164,35,0.28),transparent_60%),radial-gradient(circle_at_80%_90%,rgba(0,223,153,0.2),transparent_55%)] bg-[#f4f3ef] text-burned-orange">
        <ShieldCheck aria-hidden className="size-8" strokeWidth={1.75} />
      </span>
      <DialogTitle className="mt-2 pr-0 text-2xl">{copy.title}</DialogTitle>
      <DialogDescription className="sr-only" id={copy.descriptionId}>
        {copy.body}
      </DialogDescription>
    </DialogHeader>
  );
}

type ReauthenticationStatusMessageProps = {
  readonly copy: ReauthenticationCopy;
  readonly failure: SignInEmailFailure | null;
  readonly linkSent: boolean;
  readonly locale: Locale;
  readonly passkeyFailure: PasskeyFailure | null;
};

/** The announcement region for a failed attempt or a sent link. */
function ReauthenticationStatus({
  codeStep,
  ...message
}: ReauthenticationStatusMessageProps & { readonly codeStep: boolean }) {
  const alert = Boolean(message.failure || message.passkeyFailure);
  return (
    <div
      id={message.copy.statusId}
      aria-live={alert ? "assertive" : "polite"}
      className={cn(
        "text-sm text-navy-blue/78",
        !codeStep && "mt-4 min-h-5 empty:mt-0 empty:min-h-0"
      )}
      role={alert ? "alert" : undefined}
    >
      <ReauthenticationStatusMessage {...message} />
    </div>
  );
}

function ReauthenticationStatusMessage({
  copy,
  failure,
  linkSent,
  locale,
  passkeyFailure,
}: ReauthenticationStatusMessageProps) {
  return (
    <>
      {failure && signInEmailFailureMessage(failure, locale)}
      {passkeyFailure &&
        {
          "wrong-account": m.accountReauthPasskeyWrongAccount({}, { locale }),
          failed: m.accountReauthPasskeyFailed({}, { locale }),
        }[passkeyFailure]}
      {!failure && !passkeyFailure && linkSent && copy.linkSent}
    </>
  );
}

/** Send a fresh email, or confirm with a passkey when the account has one. */
function ReauthenticationOptions({
  copy,
  iconHeader,
  linkSent,
  locale,
  onConfirmPasskey,
  onRequestLink,
  passkeyPending,
  purpose,
  sending,
}: {
  readonly copy: ReauthenticationCopy;
  readonly iconHeader: boolean;
  readonly linkSent: boolean;
  readonly locale: Locale;
  /** Absent when the account has no passkey to confirm with. */
  readonly onConfirmPasskey: (() => Promise<void>) | undefined;
  readonly onRequestLink: () => Promise<void>;
  readonly passkeyPending: boolean;
  readonly purpose: AccountReauthenticationPurpose;
  readonly sending: boolean;
}) {
  // The options stack full-width under the centred header, so long labels
  // never overflow.
  return (
    <DialogFooter className={cn(iconHeader && "sm:flex-col-reverse")}>
      <Button
        id={copy.sendId}
        wrap
        type="button"
        variant={onConfirmPasskey ? "secondary" : undefined}
        disabled={sending || linkSent || passkeyPending}
        onClick={onRequestLink}
      >
        {m.accountReauthSendEmail({}, { locale })}
      </Button>
      {onConfirmPasskey && (
        <ReauthenticationPasskeyButton
          disabled={sending || passkeyPending}
          id={`${purpose}-reauth-passkey`}
          locale={locale}
          onClick={onConfirmPasskey}
          pending={passkeyPending}
        />
      )}
    </DialogFooter>
  );
}

function ReauthenticationPasskeyButton({
  disabled,
  id,
  locale,
  onClick,
  pending,
}: {
  readonly disabled: boolean;
  readonly id: string;
  readonly locale: Locale;
  readonly onClick: () => Promise<void>;
  readonly pending: boolean;
}) {
  return (
    <Button id={id} wrap type="button" disabled={disabled} onClick={onClick}>
      {pending ? (
        <Loader2 aria-hidden className="size-4 animate-spin" />
      ) : (
        <KeyRound aria-hidden className="size-4" />
      )}
      {pending
        ? m.accountReauthPasskeyPending({}, { locale })
        : m.accountReauthPasskey({}, { locale })}
    </Button>
  );
}
