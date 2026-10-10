"use client";

import { useState } from "react";
import { useFormContext } from "react-hook-form";
import { type Locale, m } from "@/features/i18n";
import {
  getAccountContactValues,
  type ReservationContactValues,
  type ReservationCustomerMode,
  type ReservationExistingCustomerForm,
} from "@/features/reservation/reservation-existing-customer";
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/shared/components/ui/form";
import { Input } from "@/shared/components/ui/input";
import { ReservationFormLabel } from "./reservation-form-label";

type ReservationCustomerFormValues = ReservationContactValues;

type ReservationCustomerFieldsProps = {
  readonly locale: Locale;
};

const reservationCustomerFieldNames = ["name", "email", "phone"] as const;

/**
 * The reservation contact mode with each mode's saved draft. The checkout form
 * owns it so the drafts outlive the section while a submission unmounts it.
 */
export function useReservationCustomer(
  existingCustomer: ReservationExistingCustomerForm | undefined
) {
  const [mode, setMode] = useState<ReservationCustomerMode>(
    existingCustomer?.initialMode ?? "contact"
  );
  const [otherContact, setOtherContact] = useState(
    existingCustomer?.otherContact
  );
  const [accountPhone, setAccountPhone] = useState("");

  return {
    accountPhone,
    mode,
    otherContact,
    setAccountPhone,
    setMode,
    setOtherContact,
  };
}

export type ReservationCustomer = ReturnType<typeof useReservationCustomer>;

/**
 * The reservation contact. A signed-in customer books on the account card
 * and can switch to the contact inputs to book for someone else; each mode
 * keeps what was typed in it across switches.
 */
export function ReservationCustomerSection({
  customer,
  existingCustomer,
  locale,
}: {
  readonly customer: ReservationCustomer;
  readonly existingCustomer?: ReservationExistingCustomerForm;
  readonly locale: Locale;
}) {
  const form = useFormContext<ReservationCustomerFormValues>();
  const { accountPhone, mode, otherContact } = customer;

  if (!existingCustomer) return <ReservationCustomerFields locale={locale} />;

  const switchTo = (
    nextMode: ReservationCustomerMode,
    values: ReservationContactValues
  ) => {
    for (const name of reservationCustomerFieldNames) {
      form.setValue(name, values[name]);
    }
    form.clearErrors([...reservationCustomerFieldNames]);
    customer.setMode(nextMode);
  };

  if (mode === "account") {
    return (
      <div className="space-y-3">
        <ReservationExistingCustomerCard
          contact={existingCustomer.contact}
          locale={locale}
        />
        <button
          className="text-sm font-semibold text-burned-orange underline underline-offset-4 transition-colors hover:text-chilean-fire"
          onClick={() => {
            customer.setAccountPhone(form.getValues("phone"));
            switchTo("contact", otherContact ?? existingCustomer.otherContact);
          }}
          type="button"
        >
          {m.reservationBookForSomeoneElse({}, { locale })}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ReservationCustomerFields locale={locale} />
      <button
        className="text-sm font-semibold text-burned-orange underline underline-offset-4 transition-colors hover:text-chilean-fire"
        onClick={() => {
          customer.setOtherContact(form.getValues());
          switchTo(
            "account",
            getAccountContactValues(existingCustomer.contact, accountPhone)
          );
        }}
        type="button"
      >
        {m.reservationUseAccountDetails({}, { locale })}
      </button>
    </div>
  );
}

function ReservationExistingCustomerCard({
  contact,
  locale,
}: {
  readonly contact: ReservationExistingCustomerForm["contact"];
  readonly locale: Locale;
}) {
  return (
    <section
      aria-labelledby="reservation-existing-customer-heading"
      className="space-y-4 rounded-[1.4rem] border border-navy-blue/10 bg-navy-blue/2.5 p-4 sm:p-5"
    >
      <h3
        className="text-sm font-semibold uppercase tracking-[0.14em] text-navy-blue/72"
        id="reservation-existing-customer-heading"
      >
        {m.reservationExistingCustomerTitle({}, { locale })}
      </h3>
      <dl className="grid gap-4 text-navy-blue md:grid-cols-2">
        <div className="md:col-span-2">
          <dt className="sr-only">{m.contactNameLabel({}, { locale })}</dt>
          <dd className="text-lg font-semibold">{contact.name}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-navy-blue/55">
            {m.contactEmailLabel({}, { locale })}
          </dt>
          <dd className="wrap-anywhere">{contact.email}</dd>
        </div>
        {contact.phone && (
          <div>
            <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-navy-blue/55">
              {m.contactPhoneLabel({}, { locale })}
            </dt>
            <dd>{contact.phone}</dd>
          </div>
        )}
      </dl>
      {!contact.phone && <ReservationPhoneField locale={locale} />}
    </section>
  );
}

function ReservationPhoneField({ locale }: { readonly locale: Locale }) {
  return (
    <ReservationTextField
      autoComplete="tel"
      label={m.contactPhoneLabel({}, { locale })}
      name="phone"
      placeholder={m.contactPhonePlaceholder({}, { locale })}
    />
  );
}

export function ReservationCustomerFields({
  locale,
}: ReservationCustomerFieldsProps) {
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
        <ReservationPhoneField locale={locale} />
      </div>

      <ReservationTextField
        autoComplete="name"
        label={m.contactNameLabel({}, { locale })}
        name="name"
        placeholder={m.contactNamePlaceholder({}, { locale })}
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
              required
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
