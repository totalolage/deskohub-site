"use client";

import { useFormContext, useWatch } from "react-hook-form";
import type { AresBusinessBillingDraft } from "@/features/account/backend/ares-business-draft";
import { ProfileTextField } from "@/features/account/components/profile-form-fields";
import {
  type ProfileFormValues,
  profileBillingFieldNames,
  profileFormInputName,
} from "@/features/account/components/profile-form-model";
import type { useAresBusinessLookup } from "@/features/account/components/use-ares-business-lookup";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/shared/components/ui/form";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";

type AresBusinessLookup = ReturnType<typeof useAresBusinessLookup>;

type ProfileBillingFieldsProps = {
  readonly locale: Locale;
  readonly aresLookup: AresBusinessLookup;
};

/**
 * The billing kind and, unless billing is hidden, the address; business
 * billing adds the company with its ARES lookup.
 */
export function ProfileBillingFields({
  locale,
  aresLookup,
}: ProfileBillingFieldsProps) {
  const { control } = useFormContext<ProfileFormValues>();
  const billingKind = useWatch({ control, name: "billingKind" });
  const invalidIco = aresLookup.state.status === "invalid-ico";
  return (
    <>
      <FormField
        control={control}
        name="billingKind"
        render={({ field, fieldState }) => (
          <FormItem className="@xl:col-span-2">
            <Label
              htmlFor="account-profile-billing-kind"
              id="account-profile-billing-kind-label"
            >
              {m.accountProfileBillingKindLabel({}, { locale })}
            </Label>
            <FormControl>
              <select
                {...field}
                aria-describedby={
                  fieldState.error ? "account-profile-billing-error" : undefined
                }
                aria-invalid={Boolean(fieldState.error) || undefined}
                aria-labelledby="account-profile-billing-kind-label"
                className="w-full rounded-xl border border-navy-blue/14 bg-white px-3 py-2.5 text-navy-blue"
                id="account-profile-billing-kind"
                name={undefined}
                onChange={(event) => {
                  field.onChange(event);
                  aresLookup.invalidate();
                }}
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
            </FormControl>
            <FormMessage
              className="text-sm font-normal text-red-700"
              id="account-profile-billing-error"
            />
          </FormItem>
        )}
      />
      {billingKind !== "hidden" && (
        <>
          {billingKind === "business" && (
            <>
              <ProfileTextField
                autoComplete="organization"
                id="account-profile-billing-company-name"
                invalidIco={invalidIco}
                label={m.accountProfileCompanyNameLabel({}, { locale })}
                maxLength={200}
                name="companyName"
                required
              />
              <CompanyIdLookupField aresLookup={aresLookup} locale={locale} />
              <ProfileTextField
                id="account-profile-billing-vat-id"
                invalidIco={invalidIco}
                label={m.accountProfileVatIdLabel({}, { locale })}
                maxLength={32}
                name="vatId"
              />
            </>
          )}
          <ProfileTextField
            autoComplete="address-line1"
            id="account-profile-billing-address-line1"
            invalidIco={invalidIco}
            label={m.accountProfileAddressLine1Label({}, { locale })}
            maxLength={200}
            name="addressLine1"
          />
          <ProfileTextField
            autoComplete="address-line2"
            id="account-profile-billing-address-line2"
            invalidIco={invalidIco}
            label={m.accountProfileAddressLine2Label({}, { locale })}
            maxLength={200}
            name="addressLine2"
          />
          <ProfileTextField
            autoComplete="address-level2"
            id="account-profile-billing-city"
            invalidIco={invalidIco}
            label={m.accountProfileCityLabel({}, { locale })}
            maxLength={100}
            name="city"
          />
          <div className="min-w-0 grid gap-5 @xl:grid-cols-2">
            <ProfileTextField
              autoComplete="postal-code"
              id="account-profile-billing-zip"
              invalidIco={invalidIco}
              label={m.accountProfileZipLabel({}, { locale })}
              maxLength={20}
              name="zip"
            />
            <ProfileTextField
              autoComplete="country"
              id="account-profile-billing-country"
              invalidIco={invalidIco}
              label={m.accountProfileCountryLabel({}, { locale })}
              maxLength={2}
              name="country"
            />
          </div>
        </>
      )}
    </>
  );
}

const aresLookupButtonLabel = (
  aresLookup: AresBusinessLookup,
  locale: Locale
) => {
  if (aresLookup.isPending) {
    return m.accountAresLookupLoading({}, { locale });
  }
  if (
    aresLookup.state.status === "not-found" ||
    aresLookup.state.status === "unavailable"
  ) {
    return m.accountAresLookupRetry({}, { locale });
  }
  return m.accountAresLookupSubmit({}, { locale });
};

/**
 * The company ID with its ARES lookup, whose result waits for review before
 * it fills the billing fields.
 */
function CompanyIdLookupField({
  locale,
  aresLookup,
}: ProfileBillingFieldsProps) {
  const form = useFormContext<ProfileFormValues>();
  const invalidIco = aresLookup.state.status === "invalid-ico";

  const applyAresReview = () => {
    const review = aresLookup.apply();
    if (!review) return;
    for (const field of profileBillingFieldNames) {
      const value = review[field];
      if (value !== undefined) {
        form.setValue(field, value, {
          shouldDirty: true,
          shouldValidate: false,
        });
      }
    }
  };

  return (
    <FormItem className="@xl:col-span-2">
      <Label
        htmlFor="account-profile-billing-company-id"
        id="account-profile-billing-company-id-label"
      >
        {m.accountAresLookupIcoLabel({}, { locale })}
      </Label>
      <FormField
        control={form.control}
        name="companyId"
        render={({ field, fieldState }) => {
          const describedBy = [
            fieldState.error
              ? "account-profile-billing-company-id-error"
              : undefined,
            invalidIco ? "account-profile-ares-status" : undefined,
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <>
              <FormControl>
                <Input
                  {...field}
                  aria-describedby={describedBy || undefined}
                  aria-invalid={
                    Boolean(fieldState.error) || invalidIco || undefined
                  }
                  aria-labelledby="account-profile-billing-company-id-label"
                  id="account-profile-billing-company-id"
                  inputMode="numeric"
                  maxLength={32}
                  name={profileFormInputName("companyId")}
                  onChange={(event) => {
                    field.onChange(event);
                    aresLookup.invalidate();
                  }}
                />
              </FormControl>
              <FormMessage
                className="text-sm font-normal text-red-700"
                id="account-profile-billing-company-id-error"
              />
            </>
          );
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          caps
          disabled={aresLookup.isPending}
          onClick={() => aresLookup.lookUp(form.getValues("companyId"))}
          shape="rounded"
          size="sm"
          tone="navy-blue"
          type="button"
        >
          {aresLookupButtonLabel(aresLookup, locale)}
        </Button>
      </div>
      <p
        aria-live="polite"
        className="min-h-5 text-sm"
        id="account-profile-ares-status"
      >
        <AresLookupStatus aresLookup={aresLookup} locale={locale} />
      </p>
      {aresLookup.state.status === "found" && (
        <AresReviewPanel
          locale={locale}
          onApply={applyAresReview}
          onDismiss={aresLookup.dismiss}
          review={aresLookup.state.review}
        />
      )}
    </FormItem>
  );
}

/**
 * The live region announces pending, found-for-review, and terminal
 * outcomes; the review panel itself stays outside the region so nothing
 * steals focus from manual entry.
 */
function AresLookupStatus({ locale, aresLookup }: ProfileBillingFieldsProps) {
  if (aresLookup.isPending) {
    return <span>{m.accountAresLookupLoading({}, { locale })}</span>;
  }
  if (aresLookup.state.status === "found") {
    return (
      <span className="text-emerald-800">
        {m.accountAresLookupReviewReady({}, { locale })}
      </span>
    );
  }
  if (aresLookup.state.status !== "idle" && aresLookup.state.message) {
    return (
      <span
        className={
          aresLookup.state.status === "invalid-ico" ||
          aresLookup.state.status === "not-found" ||
          aresLookup.state.status === "unavailable"
            ? "text-red-700"
            : "text-emerald-800"
        }
      >
        {aresLookup.state.message}
      </span>
    );
  }
  return null;
}

function AresReviewPanel({
  locale,
  onApply,
  onDismiss,
  review,
}: {
  readonly locale: Locale;
  readonly onApply: () => void;
  readonly onDismiss: () => void;
  readonly review: AresBusinessBillingDraft;
}) {
  const presentEntries = (
    [
      ["companyName", m.accountProfileCompanyNameLabel({}, { locale })],
      ["companyId", m.accountProfileCompanyIdLabel({}, { locale })],
      ["vatId", m.accountProfileVatIdLabel({}, { locale })],
      ["addressLine1", m.accountProfileAddressLine1Label({}, { locale })],
      ["addressLine2", m.accountProfileAddressLine2Label({}, { locale })],
      ["city", m.accountProfileCityLabel({}, { locale })],
      ["zip", m.accountProfileZipLabel({}, { locale })],
      ["country", m.accountProfileCountryLabel({}, { locale })],
    ] as const
  ).filter(([field]) => review[field] !== undefined);

  return (
    <div className="space-y-3 rounded-2xl border border-navy-blue/12 bg-navy-blue/3 p-4">
      <p className="text-sm font-bold text-navy-blue">
        {m.accountAresLookupReviewTitle({}, { locale })}
      </p>
      <dl className="grid gap-1 text-sm text-navy-blue">
        {presentEntries.map(([field, label]) => (
          <div className="flex min-w-0 gap-2" key={field}>
            <dt className="shrink-0 font-semibold">{label}:</dt>
            <dd className="min-w-0 break-words">{review[field]}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button caps onClick={onApply} shape="rounded" size="sm" type="button">
          {m.accountAresLookupApply({}, { locale })}
        </Button>
        <Button
          caps
          onClick={onDismiss}
          shape="rounded"
          size="sm"
          tone="outline"
          type="button"
          variant="ghost"
        >
          {m.accountAresLookupDismiss({}, { locale })}
        </Button>
      </div>
    </div>
  );
}
