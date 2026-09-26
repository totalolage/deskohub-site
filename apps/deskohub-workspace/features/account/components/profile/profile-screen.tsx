"use client";

import { Camera, Check, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useId, useState } from "react";
import { updatePreferredLanguage } from "@/features/account/actions";
import { FutureFeatureTooltip } from "@/features/account/components/future-feature-tooltip";
import { AccountSectionPanel } from "@/features/account/components/shell/account-section-panel";
import type { Locale } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import {
  EmailVerificationStatus,
  type EmailVerificationStatusCopy,
} from "./email-verification-status";

/*
 * Direction: extend the account's quiet Sculpin operate surface with a white
 * profile card. Identity is factual, while unavailable settings stay visibly
 * non-interactive and all editable fields remain caller-owned. The preferred
 * communication language is a Workspace-owned durable preference: it saves
 * through its own server action, never through the surrounding Dotypos
 * profile form.
 */

/**
 * The server-read state of the saved preference: `null` when no preference
 * row exists, `"read-failed"` when the read could not be completed, and
 * otherwise the persisted locale.
 */
export type PreferredLanguageState = Locale | null | "read-failed";

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
  readonly languageSave: string;
  readonly languageSaving: string;
  readonly languageSaved: string;
  readonly languageSaveFailed: string;
  readonly languageReadUnavailable: string;
  readonly languageOptionCs: string;
  readonly languageOptionEn: string;
}

export interface ProfileScreenProps {
  readonly firstName: string;
  readonly lastName: string | null;
  readonly email: string;
  readonly locale: Locale;
  readonly copy: ProfileScreenCopy;
  readonly preferredLanguage?: PreferredLanguageState;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}

/**
 * Resolves the announced save-status copy for the current action state:
 * saving wins while executing, then the saved result, then the failure.
 */
const languageStatusCopy = (input: {
  readonly copy: ProfileScreenCopy;
  readonly isSaving: boolean;
  readonly saved: boolean;
  readonly serverError: string | null;
}): string | null => {
  if (input.isSaving) return input.copy.languageSaving;
  if (input.saved) return input.copy.languageSaved;
  if (input.serverError !== null) return input.copy.languageSaveFailed;
  return null;
};

const languageOptions = [
  { locale: "cs-CZ", label: "languageOptionCs" },
  { locale: "en-US", label: "languageOptionEn" },
] as const satisfies readonly {
  locale: Locale;
  label: keyof ProfileScreenCopy;
}[];

export function ProfileScreen({
  children,
  copy,
  email,
  firstName,
  footer,
  lastName,
  locale,
  preferredLanguage = null,
}: ProfileScreenProps) {
  const router = useRouter();
  const titleId = useId();
  const languageId = useId();
  const avatarDescriptionId = `${languageId}-avatar-description`;
  const [selectedLanguage, setSelectedLanguage] = useState<Locale | null>(null);
  const {
    execute: saveLanguage,
    isExecuting: isSaving,
    result,
  } = useWorkspaceAction(updatePreferredLanguage, {
    actionName: "account.update-language",
    onSuccess: () => {
      void router.refresh();
    },
  });
  const nameParts = [firstName, lastName ?? ""]
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const displayName = nameParts.join(" ") || copy.memberFallback;
  const initials = nameParts
    .map((name) => Array.from(name)[0])
    .filter((initial): initial is string => initial !== undefined)
    .join("");

  const hasSavedLanguage =
    preferredLanguage !== null && preferredLanguage !== "read-failed";
  const savedLanguage = hasSavedLanguage ? preferredLanguage : null;
  const languageValue = selectedLanguage ?? savedLanguage;
  const languagePlaceholder =
    preferredLanguage === "read-failed"
      ? copy.languageReadUnavailable
      : copy.languageUnavailableValue;
  const languageStatus = languageStatusCopy({
    copy,
    isSaving,
    serverError: result.serverError ?? null,
    saved: result.data != null,
  });

  const handleSaveLanguage = () => {
    if (!selectedLanguage || isSaving) return;
    saveLanguage({ locale: selectedLanguage });
  };

  return (
    <AccountSectionPanel
      className="min-w-0"
      data-screen="profile-screen"
      footer={footer}
      title={copy.title}
      titleId={titleId}
    >
      <div className="flex min-w-0 flex-col gap-5 sm:flex-row sm:items-center">
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
          <span className="absolute -right-1 -bottom-1 inline-flex size-10">
            <FutureFeatureTooltip locale={locale}>
              <Button
                aria-describedby={avatarDescriptionId}
                aria-label={copy.avatarUnavailableLabel}
                className="size-10 rounded-full border border-[#dfe4ec] bg-white p-0 text-[#344258] shadow-[0_3px_10px_rgba(0,2,79,0.14)] disabled:cursor-not-allowed"
                disabled
                size="icon"
                type="button"
                variant="secondary"
              >
                <Camera aria-hidden="true" className="size-4" strokeWidth={2} />
              </Button>
            </FutureFeatureTooltip>
          </span>
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
        <Select
          disabled={isSaving}
          onValueChange={(value) => setSelectedLanguage(value as Locale)}
          value={languageValue ?? undefined}
        >
          <SelectTrigger
            id={languageId}
            className="mt-2 min-h-11 w-full rounded-2xl border border-[#cad3df] bg-[#f8fafc] px-3 py-2 text-base text-[#52647c] outline-none focus-visible:ring-2 focus-visible:ring-burned-orange"
          >
            <SelectValue placeholder={languagePlaceholder} />
          </SelectTrigger>
          <SelectContent>
            {languageOptions.map((option) => (
              <SelectItem key={option.locale} value={option.locale}>
                {copy[option.label]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <Button
            className="rounded-xl bg-burned-orange px-4 text-xs uppercase tracking-[0.08em] hover:bg-burned-orange/90"
            disabled={isSaving || selectedLanguage === null}
            onClick={handleSaveLanguage}
            size="sm"
            type="button"
          >
            {isSaving ? copy.languageSaving : copy.languageSave}
          </Button>
          <div aria-live="polite" className="min-h-5 text-sm">
            {languageStatus !== null ? (
              <p
                className={
                  result.serverError ? "text-red-700" : "text-emerald-800"
                }
              >
                {languageStatus}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </AccountSectionPanel>
  );
}
