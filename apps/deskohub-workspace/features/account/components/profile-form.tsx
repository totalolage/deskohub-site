"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  completeCustomerProfile,
  updateCustomerProfile,
} from "@/features/account/actions";
import type { CustomerProfileBilling } from "@/features/account/backend/customer-dotypos-adapter.service";
import type { CustomerProfileInput } from "@/features/account/contracts";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";

export type CustomerProfileFormMode = "complete" | "edit";

type ProfileFormProps = {
  readonly email: string;
  readonly locale: Locale;
  readonly mode: CustomerProfileFormMode;
  readonly profile?: {
    readonly firstName: string;
    readonly lastName: string | null;
    readonly phone: string | null;
    readonly billing: CustomerProfileBilling | null;
  };
};

type BillingKind = "hidden" | "personal" | "business";

const readBilling = (
  formData: FormData,
  kind: BillingKind
): CustomerProfileInput["billing"] => {
  if (kind === "business") {
    return {
      kind: "business",
      companyName: nonEmpty(formData.get("billingCompanyName")) ?? "",
      companyId: nonEmpty(formData.get("billingCompanyId")),
      vatId: nonEmpty(formData.get("billingVatId")),
      addressLine1: nonEmpty(formData.get("billingAddressLine1")),
      addressLine2: nonEmpty(formData.get("billingAddressLine2")),
      city: nonEmpty(formData.get("billingCity")),
      zip: nonEmpty(formData.get("billingZip")),
      country: nonEmpty(formData.get("billingCountry")),
    };
  }
  if (kind === "personal") {
    return {
      kind: "personal",
      addressLine1: nonEmpty(formData.get("billingAddressLine1")),
      addressLine2: nonEmpty(formData.get("billingAddressLine2")),
      city: nonEmpty(formData.get("billingCity")),
      zip: nonEmpty(formData.get("billingZip")),
      country: nonEmpty(formData.get("billingCountry")),
    };
  }
  return undefined;
};

const nonEmpty = (value: FormDataEntryValue | null) => {
  if (value instanceof File) return undefined;
  const text = value?.trim() ?? "";
  return text ? text : undefined;
};

export function ProfileForm({
  email,
  locale,
  mode,
  profile,
}: ProfileFormProps) {
  const router = useRouter();
  const [billingKind, setBillingKind] = useState<BillingKind>(
    profile?.billing?.kind ?? "hidden"
  );

  const action = (
    mode === "complete" ? completeCustomerProfile : updateCustomerProfile
  ) as typeof updateCustomerProfile;

  const { execute, isExecuting, result } = useWorkspaceAction(action, {
    actionName: "account.profile",
    onSuccess: () => {
      router.refresh();
    },
  });

  const submit = (formData: FormData) => {
    const input: CustomerProfileInput = {
      firstName: String(formData.get("firstName") ?? "").trim(),
      lastName: nonEmpty(formData.get("lastName")),
      phone: nonEmpty(formData.get("phone")),
      billing: readBilling(formData, billingKind),
    };
    execute(input);
  };

  const isComplete = mode === "complete";
  const submitLabel = isComplete
    ? m.accountCompletionSubmit({}, { locale })
    : m.accountProfileSave({}, { locale });
  const validationErrors = result.validationErrors;
  const hasValidationErrors = Boolean(
    validationErrors && Object.keys(validationErrors).length > 0
  );

  return (
    <form
      id="account-profile-form"
      action={submit}
      className="space-y-6"
      aria-describedby="account-profile-feedback"
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="account-profile-first-name">
            {m.accountProfileFirstNameLabel({}, { locale })}
          </Label>
          <Input
            id="account-profile-first-name"
            name="firstName"
            defaultValue={profile?.firstName}
            required
            maxLength={100}
            autoComplete="given-name"
            aria-invalid={Boolean(validationErrors?.fieldErrors?.firstName)}
            aria-describedby={
              validationErrors?.fieldErrors?.firstName
                ? "account-profile-first-name-error"
                : undefined
            }
          />
          {validationErrors?.fieldErrors?.firstName ? (
            <p
              id="account-profile-first-name-error"
              className="text-sm text-red-700"
            >
              {m.accountProfileFirstNameRequired({}, { locale })}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="account-profile-last-name">
            {m.accountProfileLastNameLabel({}, { locale })}
          </Label>
          <Input
            id="account-profile-last-name"
            name="lastName"
            defaultValue={profile?.lastName ?? undefined}
            maxLength={100}
            autoComplete="family-name"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="account-profile-phone">
            {m.accountProfilePhoneLabel({}, { locale })}
          </Label>
          <Input
            id="account-profile-phone"
            name="phone"
            type="tel"
            defaultValue={profile?.phone ?? undefined}
            maxLength={32}
            autoComplete="tel"
            aria-invalid={Boolean(validationErrors?.fieldErrors?.phone)}
            aria-describedby={
              validationErrors?.fieldErrors?.phone
                ? "account-profile-phone-error"
                : undefined
            }
          />
          {validationErrors?.fieldErrors?.phone ? (
            <p
              id="account-profile-phone-error"
              className="text-sm text-red-700"
            >
              {m.accountProfilePhoneInvalid({}, { locale })}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="account-profile-email">
            {m.accountProfileEmailLabel({}, { locale })}
          </Label>
          <Input
            id="account-profile-email"
            value={email}
            type="email"
            autoComplete="email"
            readOnly
            aria-readonly="true"
            className="bg-navy-blue/3 text-navy-blue/70"
          />
          <p className="text-xs leading-5 text-navy-blue/58">
            {m.accountProfileEmailReadonly({}, { locale })}
          </p>
        </div>
      </div>

      <details className="rounded-2xl border border-navy-blue/12 p-4">
        <summary className="cursor-pointer text-sm font-bold text-navy-blue">
          {m.accountProfileBillingSummary({}, { locale })}
        </summary>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="account-profile-billing-kind">
              {m.accountProfileBillingKindLabel({}, { locale })}
            </Label>
            <select
              id="account-profile-billing-kind"
              value={billingKind}
              onChange={(event) =>
                setBillingKind(event.target.value as BillingKind)
              }
              className="w-full rounded-xl border border-navy-blue/14 bg-white px-3 py-2.5 text-navy-blue"
            >
              <option value="hidden">
                {m.accountProfileBillingNone({}, { locale })}
              </option>
              <option value="personal">
                {m.accountProfileBillingPersonal({}, { locale })}
              </option>
              <option value="business">
                {m.accountProfileBillingBusiness({}, { locale })}
              </option>
            </select>
          </div>
          {billingKind !== "hidden" ? (
            <>
              {billingKind === "business" ? (
                <>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="account-profile-billing-company-name">
                      {m.accountProfileCompanyNameLabel({}, { locale })}
                    </Label>
                    <Input
                      id="account-profile-billing-company-name"
                      name="billingCompanyName"
                      defaultValue={profile?.billing?.companyName ?? undefined}
                      maxLength={200}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="account-profile-billing-company-id">
                      {m.accountProfileCompanyIdLabel({}, { locale })}
                    </Label>
                    <Input
                      id="account-profile-billing-company-id"
                      name="billingCompanyId"
                      defaultValue={profile?.billing?.companyId ?? undefined}
                      maxLength={32}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="account-profile-billing-vat-id">
                      {m.accountProfileVatIdLabel({}, { locale })}
                    </Label>
                    <Input
                      id="account-profile-billing-vat-id"
                      name="billingVatId"
                      defaultValue={profile?.billing?.vatId ?? undefined}
                      maxLength={32}
                    />
                  </div>
                </>
              ) : null}
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="account-profile-billing-address-line1">
                  {m.accountProfileAddressLine1Label({}, { locale })}
                </Label>
                <Input
                  id="account-profile-billing-address-line1"
                  name="billingAddressLine1"
                  defaultValue={profile?.billing?.addressLine1 ?? undefined}
                  maxLength={200}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="account-profile-billing-address-line2">
                  {m.accountProfileAddressLine2Label({}, { locale })}
                </Label>
                <Input
                  id="account-profile-billing-address-line2"
                  name="billingAddressLine2"
                  defaultValue={profile?.billing?.addressLine2 ?? undefined}
                  maxLength={200}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="account-profile-billing-city">
                  {m.accountProfileCityLabel({}, { locale })}
                </Label>
                <Input
                  id="account-profile-billing-city"
                  name="billingCity"
                  defaultValue={profile?.billing?.city ?? undefined}
                  maxLength={100}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="account-profile-billing-zip">
                  {m.accountProfileZipLabel({}, { locale })}
                </Label>
                <Input
                  id="account-profile-billing-zip"
                  name="billingZip"
                  defaultValue={profile?.billing?.zip ?? undefined}
                  maxLength={20}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="account-profile-billing-country">
                  {m.accountProfileCountryLabel({}, { locale })}
                </Label>
                <Input
                  id="account-profile-billing-country"
                  name="billingCountry"
                  defaultValue={profile?.billing?.country ?? undefined}
                  maxLength={2}
                  autoComplete="country"
                />
              </div>
            </>
          ) : null}
        </div>
      </details>

      <div
        id="account-profile-feedback"
        aria-live="polite"
        className="min-h-5 text-sm"
      >
        {result.data ? (
          <p className="text-emerald-800">
            {isComplete
              ? m.accountCompletionSaved({}, { locale })
              : m.accountProfileSaved({}, { locale })}
          </p>
        ) : null}
        {result.serverError ? (
          <p className="text-red-700">{result.serverError}</p>
        ) : null}
        {hasValidationErrors && !result.serverError ? (
          <p className="text-red-700">
            {m.accountProfileValidationError({}, { locale })}
          </p>
        ) : null}
      </div>

      <Button id="account-profile-submit" type="submit" disabled={isExecuting}>
        {isExecuting ? m.accountProfileSaving({}, { locale }) : submitLabel}
      </Button>
    </form>
  );
}
