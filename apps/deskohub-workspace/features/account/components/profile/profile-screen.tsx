"use client";

import { Check } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { updateLocalePreference } from "@/features/account/actions";
import { AccountSectionPanel } from "@/features/account/components/shell/account-section-panel";
import {
  type LocalePreferenceSaving,
  switchLocale,
} from "@/features/account/switch-locale";
import {
  isLocale,
  type Locale,
  type LocalizedCopy,
  locales,
  m,
} from "@/features/i18n";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { EmailVerificationStatus } from "./email-verification-status";

/*
 * Direction: extend the account's quiet Sculpin operate surface with a white
 * profile card. Identity is factual, while unavailable settings stay visibly
 * non-interactive and all editable fields remain caller-owned. The avatar
 * media and its controls are caller-owned so the profile form owns their
 * mutation state. The preferred language is the page locale, which on the
 * account page is the signed-in customer's saved locale preference: choosing
 * another one switches the site exactly like the header switcher, never
 * through the surrounding Dotypos profile form.
 */

export interface ProfileScreenProps {
  readonly firstName: string;
  readonly lastName: string | null;
  readonly email: string;
  readonly locale: Locale;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly avatar?: ReactNode;
}

/**
 * Every Inlang locale must have a translated label message, so adding a locale
 * to the tuple is a compile error until this record gains its label. The
 * option list derives from the tuple, keeping the selector exhaustive.
 */
const languageOptionLabels = {
  "cs-CZ": m.accountProfileScreenLanguageOptionCs,
  "en-US": m.accountProfileScreenLanguageOptionEn,
} satisfies Readonly<Record<Locale, LocalizedCopy>>;

// The profile renders only for a signed-in customer, so a choice always saves
// the preference before the document moves to the chosen locale.
const signedInLocalePreference: LocalePreferenceSaving = {
  signedIn: Promise.resolve(true),
  save: updateLocalePreference,
};

export function ProfileScreen({
  avatar,
  children,
  email,
  firstName,
  footer,
  lastName,
  locale,
}: ProfileScreenProps) {
  const titleId = useId();
  const languageId = useId();
  const [switchingLocale, setSwitchingLocale] = useState<Locale | null>(null);
  const nameParts = [firstName, lastName ?? ""]
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const displayName =
    nameParts.join(" ") || m.accountProfileScreenMemberFallback({}, { locale });

  const handleLanguageChange = (value: string) => {
    if (!isLocale(value) || switchingLocale !== null) return;
    setSwitchingLocale(value);
    void switchLocale(value, signedInLocalePreference);
  };

  return (
    <AccountSectionPanel
      className="min-w-0"
      data-screen="profile-screen"
      footer={footer}
      title={m.accountProfileScreenTitle({}, { locale })}
      titleId={titleId}
    >
      <div className="flex min-w-0 flex-col gap-5 @xl:flex-row @xl:items-start">
        {avatar}
        <div className="min-w-0">
          <p className="break-words text-2xl font-semibold leading-tight text-[#202b3d]">
            {displayName}
          </p>
          <span className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full bg-[#eef0ff] px-2.5 py-1 text-sm font-semibold text-[#3536c9]">
            <Check aria-hidden="true" className="size-4 shrink-0" />
            <span className="break-words">
              {m.accountProfileScreenVerifiedEmail({}, { locale })}
            </span>
          </span>
        </div>
      </div>

      <div className="mt-8 grid min-w-0 gap-x-6 gap-y-5 @xl:grid-cols-2 [&>div]:min-w-0 [&>div]:space-y-2 [&_label]:block [&_label]:text-[13px] [&_label]:font-bold [&_label]:uppercase [&_label]:leading-5 [&_label]:tracking-[0.04em] [&_label]:text-[#344258] [&_[data-slot=label]]:block [&_[data-slot=label]]:text-[13px] [&_[data-slot=label]]:font-bold [&_[data-slot=label]]:uppercase [&_[data-slot=label]]:leading-5 [&_[data-slot=label]]:tracking-[0.04em] [&_[data-slot=label]]:text-[#344258] [&_input]:h-11 [&_input]:min-h-11 [&_input]:w-full [&_input]:rounded-2xl [&_input]:px-3 [&_input]:py-2 [&_input]:text-base [&_[data-slot=input]]:h-11 [&_[data-slot=input]]:min-h-11 [&_[data-slot=input]]:w-full [&_[data-slot=input]]:rounded-2xl [&_[data-slot=input]]:px-3 [&_[data-slot=input]]:py-2 [&_[data-slot=input]]:text-base">
        {children}

        <fieldset
          aria-labelledby={`${languageId}-email-label`}
          className="m-0 min-w-0 space-y-2 border-0 p-0 @xl:col-span-2 @3xl:col-span-1"
        >
          <legend
            className="block text-[13px] font-bold uppercase leading-5 tracking-[0.04em] text-[#344258]"
            id={`${languageId}-email-label`}
          >
            {m.accountProfileEmailLabel({}, { locale })}
          </legend>
          <div className="flex min-h-11 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-[#cad3df] bg-[#f8fafc] px-3 py-2 text-base leading-6 text-[#202b3d]">
            <span className="min-w-0 flex-1 break-all">{email}</span>
            <EmailVerificationStatus emailVerified={true} locale={locale} />
          </div>
        </fieldset>
      </div>

      <div className="mt-6 min-w-0">
        <Label
          className="block text-[13px] font-bold uppercase leading-5 tracking-[0.04em] text-[#344258]"
          htmlFor={languageId}
        >
          {m.accountProfileScreenLanguageLabel({}, { locale })}
        </Label>
        <Select
          disabled={switchingLocale !== null}
          onValueChange={handleLanguageChange}
          value={switchingLocale ?? locale}
        >
          <SelectTrigger
            id={languageId}
            className="mt-2 min-h-11 w-full rounded-2xl border border-[#cad3df] bg-[#f8fafc] px-3 py-2 text-base text-[#52647c] outline-none focus-visible:ring-2 focus-visible:ring-burned-orange"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {locales.map((optionLocale) => (
              <SelectItem key={optionLocale} value={optionLocale}>
                {languageOptionLabels[optionLocale]({}, { locale })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </AccountSectionPanel>
  );
}
