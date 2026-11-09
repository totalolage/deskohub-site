"use client";

import { useFormContext } from "react-hook-form";
import {
  type ProfileFormField,
  type ProfileFormValues,
  profileFormInputName,
} from "@/features/account/components/profile-form-model";
import { type Locale, m } from "@/features/i18n";
import { formatReferralInvitationDiscount } from "@/features/referrals/client";
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/shared/components/ui/form";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";

const profileFieldLayoutClass = (name: ProfileFormField) => {
  if (name === "companyName" || name === "companyId") return "@xl:col-span-2";
  if (name === "addressLine1" || name === "addressLine2") return "min-w-0";
  return undefined;
};

type ProfileTextFieldProps = {
  readonly name: ProfileFormField;
  readonly autoComplete?: string;
  readonly id: string;
  readonly inputMode?: "numeric";
  readonly label: string;
  readonly maxLength: number;
  readonly required?: boolean;
  readonly type?: "tel";
  /** Whether ARES rejected the IČO, which marks the company ID invalid. */
  readonly invalidIco?: boolean;
};

/** A labelled text input for one profile form field, with its error. */
export function ProfileTextField({
  name,
  invalidIco = false,
  ...options
}: ProfileTextFieldProps) {
  const { control } = useFormContext<ProfileFormValues>();
  return (
    <FormField
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const describedBy = [
          fieldState.error ? `${options.id}-error` : undefined,
          name === "companyId" && invalidIco
            ? "account-profile-ares-status"
            : undefined,
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <FormItem className={profileFieldLayoutClass(name)}>
            <Label htmlFor={options.id} id={`${options.id}-label`}>
              {options.label}
            </Label>
            <FormControl>
              <Input
                {...field}
                aria-describedby={describedBy || undefined}
                aria-invalid={
                  Boolean(fieldState.error) ||
                  (name === "companyId" && invalidIco) ||
                  undefined
                }
                aria-labelledby={`${options.id}-label`}
                autoComplete={options.autoComplete}
                id={options.id}
                inputMode={options.inputMode}
                maxLength={options.maxLength}
                name={profileFormInputName(name)}
                required={options.required}
                type={options.type}
              />
            </FormControl>
            <FormMessage
              className="text-sm font-normal text-red-700"
              id={`${options.id}-error`}
            />
          </FormItem>
        );
      }}
    />
  );
}

/** The customer's name and phone. */
export function ProfileIdentityFields({ locale }: { readonly locale: Locale }) {
  return (
    <>
      <ProfileTextField
        autoComplete="given-name"
        id="account-profile-first-name"
        label={m.accountProfileFirstNameLabel({}, { locale })}
        maxLength={100}
        name="firstName"
        required
      />
      <ProfileTextField
        autoComplete="family-name"
        id="account-profile-last-name"
        label={m.accountProfileLastNameLabel({}, { locale })}
        maxLength={100}
        name="lastName"
      />
      <ProfileTextField
        autoComplete="tel"
        id="account-profile-phone"
        label={m.accountProfilePhoneLabel({}, { locale })}
        maxLength={32}
        name="phone"
        type="tel"
      />
    </>
  );
}

/** First-time completion's optional invitation code. */
export function ProfileReferralCodeField({
  locale,
}: {
  readonly locale: Locale;
}) {
  const { control } = useFormContext<ProfileFormValues>();
  return (
    <FormField
      control={control}
      name="referralCode"
      render={({ field, fieldState }) => (
        <FormItem>
          <Label
            htmlFor="profile-referral-code"
            id="profile-referral-code-label"
          >
            {m.accountProfileReferralCodeLabel({}, { locale })}
          </Label>
          <FormControl>
            <Input
              {...field}
              aria-describedby={[
                "profile-referral-code-hint",
                fieldState.error ? "profile-referral-code-error" : undefined,
              ]
                .filter(Boolean)
                .join(" ")}
              aria-invalid={Boolean(fieldState.error) || undefined}
              aria-labelledby="profile-referral-code-label"
              autoCapitalize="characters"
              autoComplete="off"
              className="uppercase"
              data-ph-mask
              id="profile-referral-code"
              maxLength={64}
              name={profileFormInputName("referralCode")}
              spellCheck={false}
            />
          </FormControl>
          <p
            className="text-sm text-navy-blue/68"
            id="profile-referral-code-hint"
          >
            {m.accountProfileReferralCodeHint(
              { discount: formatReferralInvitationDiscount(locale) },
              { locale }
            )}
          </p>
          <FormMessage
            className="text-sm font-normal text-red-700"
            id="profile-referral-code-error"
          />
        </FormItem>
      )}
    />
  );
}
