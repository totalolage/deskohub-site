import { Camera, Check, UserRound } from "lucide-react";
import { type ReactNode, useId } from "react";
import { Button } from "@/shared/components/ui/button";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  EmailVerificationStatus,
  type EmailVerificationStatusCopy,
} from "./email-verification-status";

/*
 * Direction: extend the account's quiet Sculpin operate surface with a white
 * profile card. Identity is factual, while unavailable settings stay visibly
 * non-interactive and all editable fields remain caller-owned.
 */

export interface ProfileScreenCopy {
  readonly title: string;
  readonly memberFallback: string;
  readonly verifiedEmail: string;
  readonly emailLabel: string;
  readonly emailVerification: EmailVerificationStatusCopy;
  readonly avatarUnavailableLabel: string;
  readonly avatarUnavailableDescription: string;
  readonly languageLabel: string;
  readonly languageUnavailableValue: string;
  readonly languageUnavailableDescription: string;
}

export interface ProfileScreenProps {
  readonly firstName: string;
  readonly lastName: string | null;
  readonly email: string;
  readonly copy: ProfileScreenCopy;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}

export function ProfileScreen({
  children,
  copy,
  email,
  firstName,
  footer,
  lastName,
}: ProfileScreenProps) {
  const titleId = useId();
  const languageId = useId();
  const languageDescriptionId = `${languageId}-description`;
  const avatarDescriptionId = `${languageId}-avatar-description`;
  const nameParts = [firstName, lastName ?? ""]
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const displayName = nameParts.join(" ") || copy.memberFallback;
  const initials = nameParts
    .map((name) => Array.from(name)[0])
    .filter((initial): initial is string => initial !== undefined)
    .join("");

  return (
    <section
      aria-labelledby={titleId}
      className="min-w-0 rounded-2xl border border-[#dfe4ec] bg-white p-5 sm:p-8"
      data-slot="profile-screen"
    >
      <h2
        className="border-b border-[#e8edf3] pb-6 text-[26px] font-bold leading-tight tracking-[-0.025em] text-[#00024f]"
        id={titleId}
      >
        {copy.title}
      </h2>

      <div className="mt-8 flex min-w-0 flex-col gap-5 sm:flex-row sm:items-center">
        <div className="relative size-20 shrink-0">
          <div
            aria-hidden="true"
            className="flex size-20 items-center justify-center rounded-full bg-[linear-gradient(135deg,#cf7253_0%,#00024f_100%)] text-2xl font-bold text-white"
          >
            {initials ? (
              initials
            ) : (
              <UserRound className="size-9" strokeWidth={1.8} />
            )}
          </div>
          <Button
            aria-describedby={avatarDescriptionId}
            aria-label={copy.avatarUnavailableLabel}
            className="absolute -right-1 -bottom-1 size-10 rounded-full border border-[#dfe4ec] bg-white p-0 text-[#344258] shadow-[0_3px_10px_rgba(0,2,79,0.14)] disabled:cursor-not-allowed"
            disabled
            size="icon"
            type="button"
            variant="secondary"
          >
            <Camera aria-hidden="true" className="size-4" strokeWidth={2} />
          </Button>
        </div>

        <div className="min-w-0">
          <p className="break-words text-2xl font-semibold leading-tight text-[#202b3d]">
            {displayName}
          </p>
          <span className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full bg-[#eef0ff] px-2.5 py-1 text-sm font-semibold text-[#3536c9]">
            <Check aria-hidden="true" className="size-4 shrink-0" />
            <span className="break-words">{copy.verifiedEmail}</span>
          </span>
          <p
            className="mt-2 max-w-prose text-sm leading-5 text-[#52647c]"
            id={avatarDescriptionId}
          >
            {copy.avatarUnavailableDescription}
          </p>
        </div>
      </div>

      <div className="mt-8 grid min-w-0 gap-x-6 gap-y-5 sm:grid-cols-2 [&>div]:min-w-0 [&>div]:space-y-2 [&_label]:block [&_label]:text-[13px] [&_label]:font-bold [&_label]:uppercase [&_label]:leading-5 [&_label]:tracking-[0.04em] [&_label]:text-[#344258] [&_[data-slot=label]]:block [&_[data-slot=label]]:text-[13px] [&_[data-slot=label]]:font-bold [&_[data-slot=label]]:uppercase [&_[data-slot=label]]:leading-5 [&_[data-slot=label]]:tracking-[0.04em] [&_[data-slot=label]]:text-[#344258] [&_input]:h-11 [&_input]:min-h-11 [&_input]:w-full [&_input]:rounded-2xl [&_input]:px-3 [&_input]:py-2 [&_input]:text-base [&_[data-slot=input]]:h-11 [&_[data-slot=input]]:min-h-11 [&_[data-slot=input]]:w-full [&_[data-slot=input]]:rounded-2xl [&_[data-slot=input]]:px-3 [&_[data-slot=input]]:py-2 [&_[data-slot=input]]:text-base">
        {children}

        <fieldset
          aria-labelledby={`${languageId}-email-label`}
          className="m-0 min-w-0 space-y-2 border-0 p-0 sm:col-span-2 lg:col-span-1"
        >
          <legend
            className="block text-[13px] font-bold uppercase leading-5 tracking-[0.04em] text-[#344258]"
            id={`${languageId}-email-label`}
          >
            {copy.emailLabel}
          </legend>
          <div className="flex min-h-11 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-[#cad3df] bg-[#f8fafc] px-3 py-2 text-base leading-6 text-[#202b3d]">
            <span className="min-w-0 flex-1 break-all">{email}</span>
            <EmailVerificationStatus
              copy={copy.emailVerification}
              emailVerified={true}
            />
          </div>
        </fieldset>
      </div>

      <div className="mt-6 min-w-0">
        <Label
          className="block text-[13px] font-bold uppercase leading-5 tracking-[0.04em] text-[#344258]"
          htmlFor={languageId}
        >
          {copy.languageLabel}
        </Label>
        <Select disabled value="unavailable">
          <SelectTrigger
            id={languageId}
            aria-describedby={languageDescriptionId}
            className="mt-2 min-h-11 w-full rounded-2xl border border-[#cad3df] bg-[#f8fafc] px-3 py-2 text-base text-[#52647c] outline-none disabled:cursor-not-allowed disabled:opacity-70 focus-visible:ring-2 focus-visible:ring-burned-orange"
          >
            <SelectValue>{copy.languageUnavailableValue}</SelectValue>
          </SelectTrigger>
        </Select>
        <p
          className="mt-2 text-sm leading-5 text-[#52647c]"
          id={languageDescriptionId}
        >
          {copy.languageUnavailableDescription}
        </p>
      </div>

      {footer !== undefined && <div className="mt-8">{footer}</div>}
    </section>
  );
}
