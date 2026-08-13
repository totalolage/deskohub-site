"use client";

import { Info } from "lucide-react";
import { useFormContext } from "react-hook-form";
import { type Locale, m } from "@/features/i18n";
import {
  defaultReservationBillingSelection,
  emptyBusinessBillingSelection,
  emptyRequestedPersonalBillingSelection,
  type ReservationBillingSelectionInput,
} from "@/features/reservation/reservation-billing";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/shared/components/ui/form";
import { Input } from "@/shared/components/ui/input";
import { Switch } from "@/shared/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";
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
              <legend className="sr-only">
                {m.reservationPurposeLabel({}, { locale })}
              </legend>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={isBusiness}
                    id="reservation-business-use"
                    onCheckedChange={(checked) =>
                      field.onChange(
                        checked
                          ? emptyBusinessBillingSelection
                          : defaultReservationBillingSelection
                      )
                    }
                  />
                  <label
                    className="cursor-pointer text-sm font-semibold text-navy-blue/76"
                    htmlFor="reservation-business-use"
                  >
                    {m.reservationPurposeBusinessLabel({}, { locale })}
                  </label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          aria-label={m.reservationBusinessUseTooltip(
                            {},
                            { locale }
                          )}
                          className="size-7 shrink-0 rounded-full p-0 text-navy-blue/55"
                          size="icon"
                          type="button"
                          variant="ghost"
                        >
                          <Info aria-hidden="true" className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent
                        collisionPadding={16}
                        className="w-[min(20rem,calc(100vw-2rem))]"
                      >
                        {m.reservationBusinessUseTooltip({}, { locale })}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>

                <label
                  className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-navy-blue/76 data-[disabled]:cursor-not-allowed"
                  data-disabled={isBusiness ? "" : undefined}
                  htmlFor="reservation-create-invoice"
                >
                  <Checkbox
                    checked={invoiceRequested}
                    disabled={isBusiness}
                    id="reservation-create-invoice"
                    onCheckedChange={(checked) =>
                      field.onChange(
                        checked
                          ? emptyRequestedPersonalBillingSelection
                          : defaultReservationBillingSelection
                      )
                    }
                  />
                  <span>{m.reservationCreateInvoiceLabel({}, { locale })}</span>
                </label>
              </div>
            </fieldset>
            <FormMessage />

            {invoiceRequested && (
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
                {isBusiness && <BusinessFields locale={locale} />}
                <AddressFields business={isBusiness} locale={locale} />
              </section>
            )}
          </FormItem>
        );
      }}
    />
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
  const { control } = useFormContext<ReservationBillingFormValues>();

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
              value={field.value ?? ""}
              variant={fieldState.error ? "error" : "default"}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
