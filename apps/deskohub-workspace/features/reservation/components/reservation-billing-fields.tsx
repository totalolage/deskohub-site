"use client";

import type { ReactNode } from "react";
import { useFormContext } from "react-hook-form";
import { type Locale, m } from "@/features/i18n";
import {
  defaultReservationBillingSelection,
  emptyBusinessBillingSelection,
  emptyRequestedPersonalBillingSelection,
  type ReservationBillingSelectionInput,
} from "@/features/reservation/reservation-billing";
import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/shared/components/ui/form";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/utils";
import { ReservationFormLabel } from "./reservation-form-label";

type ReservationBillingFormValues = {
  readonly billing: ReservationBillingSelectionInput;
};

type BillingFieldName =
  | "billing.address.line1"
  | "billing.address.line2"
  | "billing.address.city"
  | "billing.address.postalCode"
  | "billing.address.country"
  | "billing.buyer.legalName"
  | "billing.buyer.companyId"
  | "billing.buyer.vatId"
  | "billing.buyer.address.line1"
  | "billing.buyer.address.line2"
  | "billing.buyer.address.city"
  | "billing.buyer.address.postalCode"
  | "billing.buyer.address.country";

export function ReservationBillingFields({
  locale,
}: {
  readonly locale: Locale;
}) {
  const { control } = useFormContext<ReservationBillingFormValues>();

  return (
    <FormField
      control={control}
      name="billing"
      render={({ field }) => {
        const billing = field.value ?? defaultReservationBillingSelection;
        const isBusiness = billing.purpose === "business";
        const invoiceRequested = isBusiness || billing.invoice === "requested";

        return (
          <FormItem>
            <fieldset>
              <legend className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-navy-blue/72">
                {m.reservationPurposeLabel({}, { locale })}
              </legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <PurposeOption
                  checked={!isBusiness}
                  description={m.reservationPurposePersonalDescription(
                    {},
                    { locale }
                  )}
                  label={m.reservationPurposePersonalLabel({}, { locale })}
                  name="reservation-purpose"
                  onChange={() =>
                    field.onChange(defaultReservationBillingSelection)
                  }
                  value="personal"
                />
                <PurposeOption
                  checked={isBusiness}
                  description={m.reservationPurposeBusinessDescription(
                    {},
                    { locale }
                  )}
                  label={m.reservationPurposeBusinessLabel({}, { locale })}
                  name="reservation-purpose"
                  onChange={() => field.onChange(emptyBusinessBillingSelection)}
                  value="business"
                />
              </div>
            </fieldset>

            <div className="mt-4">
              {isBusiness ? (
                <p className="rounded-[1.2rem] bg-burned-orange/8 px-4 py-3 text-sm leading-6 text-navy-blue/72">
                  {m.reservationBusinessInvoiceNotice({}, { locale })}
                </p>
              ) : (
                <label
                  className="flex cursor-pointer items-center gap-3 rounded-[1.2rem] border border-navy-blue/10 px-4 py-3"
                  htmlFor="reservation-personal-invoice"
                >
                  <Checkbox
                    checked={invoiceRequested}
                    id="reservation-personal-invoice"
                    onCheckedChange={(checked) =>
                      field.onChange(
                        checked
                          ? emptyRequestedPersonalBillingSelection
                          : defaultReservationBillingSelection
                      )
                    }
                  />
                  <span className="text-sm font-semibold text-navy-blue/76">
                    {m.reservationPersonalInvoiceLabel({}, { locale })}
                  </span>
                </label>
              )}
            </div>
            <FormMessage />

            {invoiceRequested ? (
              <section
                aria-labelledby="reservation-billing-details-heading"
                className="mt-5 space-y-5 rounded-[1.4rem] border border-navy-blue/10 bg-navy-blue/2.5 p-4 sm:p-5"
              >
                <h3
                  className="text-sm font-semibold uppercase tracking-[0.14em] text-navy-blue/72"
                  id="reservation-billing-details-heading"
                >
                  {m.reservationBillingDetailsLabel({}, { locale })}
                </h3>
                {isBusiness ? <BusinessFields locale={locale} /> : null}
                <AddressFields business={isBusiness} locale={locale} />
              </section>
            ) : null}
          </FormItem>
        );
      }}
    />
  );
}

function PurposeOption({
  checked,
  description,
  label,
  name,
  onChange,
  value,
}: {
  readonly checked: boolean;
  readonly description: string;
  readonly label: ReactNode;
  readonly name: string;
  readonly onChange: () => void;
  readonly value: string;
}) {
  return (
    <label
      className={cn(
        "cursor-pointer rounded-[1.2rem] border p-4 transition focus-within:ring-2 focus-within:ring-burned-orange focus-within:ring-offset-2",
        checked
          ? "border-burned-orange bg-burned-orange/8"
          : "border-navy-blue/10 bg-white"
      )}
    >
      <input
        checked={checked}
        className="sr-only"
        name={name}
        onChange={onChange}
        type="radio"
        value={value}
      />
      <span className="flex items-center justify-between gap-3 font-semibold text-navy-blue">
        {label}
        <span
          aria-hidden
          className="flex size-5 items-center justify-center rounded-full border border-current text-xs"
        >
          {checked ? "✓" : null}
        </span>
      </span>
      <span className="mt-1 block text-sm leading-5 text-navy-blue/60">
        {description}
      </span>
    </label>
  );
}

function BusinessFields({ locale }: { readonly locale: Locale }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <BillingTextField
        autoComplete="organization"
        label={m.reservationBillingCompanyNameLabel({}, { locale })}
        name="billing.buyer.legalName"
      />
      <BillingTextField
        label={m.reservationBillingCompanyIdLabel({}, { locale })}
        name="billing.buyer.companyId"
      />
      <BillingTextField
        label={m.reservationBillingVatIdLabel({}, { locale })}
        name="billing.buyer.vatId"
        optional
      />
    </div>
  );
}

function AddressFields({
  business,
  locale,
}: {
  readonly business: boolean;
  readonly locale: Locale;
}) {
  const address = business ? "billing.buyer.address" : "billing.address";
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <BillingTextField
        autoComplete="address-line1"
        label={m.reservationBillingAddressLine1Label({}, { locale })}
        name={`${address}.line1` as BillingFieldName}
      />
      <BillingTextField
        autoComplete="address-line2"
        label={m.reservationBillingAddressLine2Label({}, { locale })}
        name={`${address}.line2` as BillingFieldName}
        optional
      />
      <BillingTextField
        autoComplete="address-level2"
        label={m.reservationBillingCityLabel({}, { locale })}
        name={`${address}.city` as BillingFieldName}
      />
      <BillingTextField
        autoComplete="postal-code"
        label={m.reservationBillingPostalCodeLabel({}, { locale })}
        name={`${address}.postalCode` as BillingFieldName}
      />
      <BillingTextField
        autoComplete="country-name"
        label={m.reservationBillingCountryLabel({}, { locale })}
        name={`${address}.country` as BillingFieldName}
      />
    </div>
  );
}

function BillingTextField({
  autoComplete,
  label,
  name,
  optional = false,
}: {
  readonly autoComplete?: string;
  readonly label: string;
  readonly name: BillingFieldName;
  readonly optional?: boolean;
}) {
  const { control } = useFormContext();

  return (
    <FormField
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FormItem>
          <ReservationFormLabel required={!optional}>
            {label}
          </ReservationFormLabel>
          <FormControl>
            <Input
              {...field}
              autoComplete={autoComplete}
              onChange={(event) =>
                field.onChange(
                  optional && !event.target.value.trim()
                    ? undefined
                    : event.target.value
                )
              }
              required={!optional}
              value={typeof field.value === "string" ? field.value : ""}
              variant={fieldState.error ? "error" : "default"}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
