"use client";

import { useFormContext } from "react-hook-form";
import { type Locale, m } from "@/features/i18n";
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/shared/components/ui/form";
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";
import { ReservationFormLabel } from "./reservation-form-label";

type ReservationCustomerFormValues = {
  readonly email: string;
  readonly message?: string;
  readonly name: string;
  readonly phone: string;
};

type ReservationCustomerFieldsProps = {
  readonly locale: Locale;
  readonly messagePlaceholder: string;
};

export function ReservationCustomerFields({
  locale,
  messagePlaceholder,
}: ReservationCustomerFieldsProps) {
  const { control } = useFormContext<ReservationCustomerFormValues>();

  return (
    <>
      <div className="grid gap-5 md:grid-cols-2">
        <ReservationTextField
          autoComplete="email"
          label={m.contactEmailLabel({}, { locale })}
          name="email"
          placeholder={m.contactEmailPlaceholder({}, { locale })}
          type="email"
        />
        <ReservationTextField
          autoComplete="tel"
          label={m.contactPhoneLabel({}, { locale })}
          name="phone"
          placeholder={m.contactPhonePlaceholder({}, { locale })}
        />
      </div>

      <ReservationTextField
        autoComplete="name"
        label={m.contactNameLabel({}, { locale })}
        name="name"
        placeholder={m.contactNamePlaceholder({}, { locale })}
      />

      <FormField
        control={control}
        name="message"
        render={({ field, fieldState }) => (
          <FormItem>
            <ReservationFormLabel>
              {m.reservationMessageLabel({}, { locale })}
            </ReservationFormLabel>
            <FormControl>
              <Textarea
                {...field}
                placeholder={messagePlaceholder}
                rows={5}
                value={field.value || ""}
                variant={fieldState.error ? "error" : "default"}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}

type ReservationTextFieldProps = {
  readonly autoComplete?: string;
  readonly label: string;
  readonly name: "email" | "name" | "phone";
  readonly placeholder: string;
  readonly type?: string;
};

function ReservationTextField({
  autoComplete,
  label,
  name,
  placeholder,
  type = "text",
}: ReservationTextFieldProps) {
  const { control } = useFormContext<ReservationCustomerFormValues>();

  return (
    <FormField
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FormItem>
          <ReservationFormLabel required>{label}</ReservationFormLabel>
          <FormControl>
            <Input
              {...field}
              autoComplete={autoComplete}
              placeholder={placeholder}
              type={type}
              value={field.value || ""}
              variant={fieldState.error ? "error" : "default"}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
