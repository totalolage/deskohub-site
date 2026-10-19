"use client";

import { useAtomValue } from "@effect/atom-react";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import type {
  SignInCodeVerification,
  SignInEmailFailure,
} from "@/features/account/auth-return";
import { signInEmailFailureMessage } from "@/features/account/components/sign-in-email-failure-message";
import { SIGN_IN_CODE_LENGTH } from "@/features/account/email-sign-in-request";
import {
  resendCooldownSecondsAtom,
  SIGN_IN_CODE_RESEND_COOLDOWN_MS,
} from "@/features/account/sign-in-code-resend-cooldown";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/shared/components/ui/input-otp";
import { cn } from "@/shared/utils";

type CodeStatus = "idle" | SignInCodeVerification | "verifying";
type ResendStatus = "idle" | "sending" | "sent" | SignInEmailFailure;

type SignInCodeStepProps = {
  readonly locale: Locale;
  /** When the email holding the current code was requested (epoch ms). */
  readonly requestedAt: number;
  readonly verifiedMessage: string;
  readonly verifyCode: (code: string) => Promise<SignInCodeVerification>;
  readonly onVerified: () => void;
  /**
   * Sends a new email and reports whether it went out, or that a cancel or a
   * newer request replaced it.
   */
  readonly requestNewEmail: () => Promise<
    "sent" | "cancelled" | SignInEmailFailure
  >;
  readonly onUseDifferentEmail?: () => void;
};

const isDeadCode = (status: CodeStatus) =>
  status === "expired" || status === "too-many-attempts";

/**
 * Code entry shared by sign-in and account-deletion re-authentication. The
 * caller renders the heading and the masked-address description.
 */
export function SignInCodeStep({
  locale,
  requestedAt,
  verifiedMessage,
  verifyCode,
  onVerified,
  requestNewEmail,
  onUseDifferentEmail,
}: SignInCodeStepProps) {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<CodeStatus>("idle");
  const [resendStatus, setResendStatus] = useState<ResendStatus>("idle");
  const [shownRequestedAt, setShownRequestedAt] = useState(requestedAt);
  const inputRef = useRef<HTMLInputElement>(null);
  const resendRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const cooldownSeconds = useAtomValue(
    resendCooldownSecondsAtom(requestedAt + SIGN_IN_CODE_RESEND_COOLDOWN_MS)
  );

  // A new email replaces the code: start the entry over.
  if (shownRequestedAt !== requestedAt) {
    setShownRequestedAt(requestedAt);
    setCode("");
    setStatus("idle");
  }

  const submitCode = async (value: string) => {
    // The disabled input keeps no focus ring while the code is checked.
    inputRef.current?.blur();
    setStatus("verifying");
    setResendStatus("idle");
    const verification = await verifyCode(value);
    setStatus(verification);
    if (verification === "verified") {
      onVerified();
      return;
    }
    setCode("");
    // Move focus once the controls re-enable: back into the input for another
    // try, or to the way out when this code can no longer work.
    requestAnimationFrame(() => {
      if (!isDeadCode(verification)) inputRef.current?.focus();
      else if (resendRef.current?.disabled === false) resendRef.current.focus();
      else statusRef.current?.focus();
    });
  };

  const sendNewEmail = async () => {
    setResendStatus("sending");
    const outcome = await requestNewEmail();
    setResendStatus(outcome === "cancelled" ? "idle" : outcome);
    if (outcome === "sent") inputRef.current?.focus();
  };

  const dead = isDeadCode(status);
  const verifying = status === "verifying";
  const verified = status === "verified";
  const invalid = status === "wrong";
  const resendDisabled =
    cooldownSeconds > 0 || resendStatus === "sending" || verifying || verified;

  const resendFailed =
    resendStatus !== "idle" &&
    resendStatus !== "sending" &&
    resendStatus !== "sent";
  // A rejected resend outranks the earlier code result so it is seen and
  // announced; checking another code clears it.
  const statusMessage = resendFailed
    ? signInEmailFailureMessage(resendStatus, locale)
    : {
        idle:
          resendStatus === "sent"
            ? m.accountSignInCodeResent({}, { locale })
            : null,
        verifying: m.accountSignInCodeVerifying({}, { locale }),
        verified: verifiedMessage,
        wrong: m.accountSignInCodeInvalid({}, { locale }),
        expired: m.accountSignInCodeExpired({}, { locale }),
        "too-many-attempts": m.accountSignInCodeTooManyAttempts({}, { locale }),
        automated: m.accountSignInAutomatedRequest({}, { locale }),
        failed: m.accountSignInCodeFailed({}, { locale }),
      }[status];
  const statusTone = resendFailed
    ? "error"
    : {
        idle: "neutral",
        verifying: "neutral",
        verified: "success",
        wrong: "error",
        expired: "error",
        "too-many-attempts": "error",
        automated: "error",
        failed: "error",
      }[status];

  return (
    <div className="mt-8">
      <label
        htmlFor="account-sign-in-code"
        className="text-sm font-semibold text-navy-blue"
      >
        {m.accountSignInCodeLabel({}, { locale })}
      </label>
      <InputOTP
        ref={inputRef}
        id="account-sign-in-code"
        autoFocus
        maxLength={SIGN_IN_CODE_LENGTH}
        pattern={REGEXP_ONLY_DIGITS}
        pasteTransformer={(pasted) => pasted.replace(/\D/g, "")}
        value={code}
        onChange={setCode}
        onComplete={submitCode}
        disabled={dead || verifying || verified}
        aria-invalid={invalid}
        aria-describedby="account-sign-in-code-status"
        containerClassName="mt-2 w-full max-w-[22rem] gap-2 sm:gap-3"
      >
        <InputOTPGroup className="flex-1 gap-1.5 sm:gap-2">
          {[0, 1, 2].map((index) => (
            <InputOTPSlot
              key={index}
              index={index}
              invalid={invalid}
              className="w-full"
            />
          ))}
        </InputOTPGroup>
        <InputOTPSeparator />
        <InputOTPGroup className="flex-1 gap-1.5 sm:gap-2">
          {[3, 4, 5].map((index) => (
            <InputOTPSlot
              key={index}
              index={index}
              invalid={invalid}
              className="w-full"
            />
          ))}
        </InputOTPGroup>
      </InputOTP>

      <div
        ref={statusRef}
        id="account-sign-in-code-status"
        aria-live="polite"
        tabIndex={-1}
        className={cn(
          "mt-3 flex min-h-5 items-start gap-2 text-sm leading-5 outline-none",
          {
            neutral: "text-navy-blue/68",
            success: "text-aquamarine-ink",
            error: "text-red-700",
          }[statusTone]
        )}
      >
        {verifying && (
          <Loader2
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 animate-spin"
          />
        )}
        {verified && (
          <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        )}
        {statusMessage}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button
          ref={resendRef}
          id="account-sign-in-code-resend"
          type="button"
          variant={dead ? "primary" : "secondary"}
          disabled={resendDisabled}
          aria-busy={resendStatus === "sending"}
          onClick={sendNewEmail}
        >
          {resendStatus === "sending" && (
            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          )}
          {cooldownSeconds > 0
            ? m.accountSignInCodeResendCooldown(
                { seconds: cooldownSeconds },
                { locale }
              )
            : m.accountSignInCodeResend({}, { locale })}
        </Button>
        {onUseDifferentEmail && (
          <Button
            type="button"
            variant="link"
            disabled={verifying || verified}
            onClick={onUseDifferentEmail}
          >
            {m.accountSignInCodeChangeEmail({}, { locale })}
          </Button>
        )}
      </div>

      <p className="mt-6 border-t border-navy-blue/10 pt-5 text-sm leading-6 text-navy-blue/60">
        {m.accountSignInCodeLinkHint({}, { locale })}
      </p>
    </div>
  );
}
