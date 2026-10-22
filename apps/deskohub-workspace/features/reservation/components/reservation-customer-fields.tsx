"use client";

import Interpolate from "@doist/react-interpolate";
import { AlertTriangle, Info, RotateCw } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useState, useTransition } from "react";
import {
  type FieldPath,
  type FieldValues,
  type UseFormReturn,
  useFormContext,
} from "react-hook-form";
import { getAccountSignInPath } from "@/features/account/routes";
import { type Locale, m } from "@/features/i18n";
import { checkoutContactQueryParam } from "@/features/reservation/reservation-checkout-contact";
import {
  getAccountContactValues,
  type ReservationCheckoutCustomerForm,
  type ReservationContactValues,
  type ReservationCustomerMode,
  type ReservationExistingCustomerForm,
} from "@/features/reservation/reservation-existing-customer";
import { Button } from "@/shared/components/ui/button";
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/shared/components/ui/form";
import { Input } from "@/shared/components/ui/input";
import { ReservationFormLabel } from "./reservation-form-label";

type ReservationCustomerFormValues = ReservationContactValues & {
  /**
   * The repeated email of someone else's contact. It only guards against a
   * typo, so it stays outside the reservation schema and its submission.
   */
  readonly emailConfirmation?: string;
};

type ReservationCustomerFieldsProps = {
  /** Asks for the email twice, for a contact who isn't the account. */
  readonly confirmsEmail?: boolean;
  /** Shows the account's login email, which the profile books with. */
  readonly fixedEmail?: boolean;
  readonly locale: Locale;
};

const reservationCustomerFieldNames = ["name", "email", "phone"] as const;

/**
 * Checks the repeated email of someone else's contact and marks the field
 * when it doesn't match. Call it with every submission of the contact inputs.
 */
export const confirmReservationContactEmail = <Input extends FieldValues, Data>(
  form: UseFormReturn<Input, unknown, Data>,
  locale: Locale
) => {
  const values: Partial<ReservationCustomerFormValues> = form.getValues();
  const normalize = (email: string | undefined) =>
    (email ?? "").trim().toLowerCase();
  if (normalize(values.emailConfirmation) === normalize(values.email)) {
    return true;
  }
  // Every reservation form holds the contact fields.
  form.setError("emailConfirmation" as FieldPath<Input>, {
    message: m.contactValidationEmailConfirmationMismatch({}, { locale }),
  });
  return false;
};

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
  checkoutCustomer,
  customer,
  locale,
}: {
  readonly checkoutCustomer: ReservationCheckoutCustomerForm;
  readonly customer: ReservationCustomer;
  readonly locale: Locale;
}) {
  if (checkoutCustomer.status === "signed-out") {
    return (
      <div className="space-y-5">
        <ReservationSignInPrompt locale={locale} />
        <ReservationCustomerFields locale={locale} />
      </div>
    );
  }

  if (checkoutCustomer.status === "unavailable") {
    return <ReservationAccountUnavailable locale={locale} />;
  }

  if (checkoutCustomer.status === "support-required") {
    return <ReservationAccountSupportRequired locale={locale} />;
  }

  if (checkoutCustomer.status === "review-account") {
    return (
      <div className="space-y-3">
        <ReservationExistingCustomerCard
          contact={checkoutCustomer.existingCustomer.contact}
          locale={locale}
        />
        <ReservationContactHint>
          {m.reservationContactReviewAccountHint({}, { locale })}
        </ReservationContactHint>
      </div>
    );
  }

  if (checkoutCustomer.status === "profile-missing") {
    return (
      <div className="space-y-5">
        <ReservationCustomerFields fixedEmail locale={locale} />
        <ReservationContactHint>
          {m.reservationContactProfileHint({}, { locale })}
        </ReservationContactHint>
      </div>
    );
  }

  return (
    <ReservationLinkedCustomerSection
      customer={customer}
      existingCustomer={checkoutCustomer.existingCustomer}
      locale={locale}
      replacesTypedContact={checkoutCustomer.replacesTypedContact}
    />
  );
}

function ReservationLinkedCustomerSection({
  customer,
  existingCustomer,
  locale,
  replacesTypedContact,
}: {
  readonly customer: ReservationCustomer;
  readonly existingCustomer: ReservationExistingCustomerForm;
  readonly locale: Locale;
  readonly replacesTypedContact: boolean;
}) {
  const form = useFormContext<ReservationCustomerFormValues>();
  const { accountPhone, mode, otherContact } = customer;

  const switchTo = (
    nextMode: ReservationCustomerMode,
    values: ReservationContactValues
  ) => {
    for (const name of reservationCustomerFieldNames) {
      form.setValue(name, values[name]);
    }
    // Details carried in rather than typed here need no second entry.
    form.setValue(
      "emailConfirmation",
      nextMode === "contact" ? values.email : ""
    );
    form.clearErrors([...reservationCustomerFieldNames, "emailConfirmation"]);
    customer.setMode(nextMode);
  };

  if (mode === "account") {
    return (
      <div className="space-y-3">
        {/* The toggle keeps its place in both modes, so it keeps focus. */}
        <div className="space-y-3">
          {replacesTypedContact && (
            <ReservationContactNotice>
              {m.reservationExistingProfileNotice({}, { locale })}
            </ReservationContactNotice>
          )}
          <ReservationExistingCustomerCard
            contact={existingCustomer.contact}
            locale={locale}
          />
        </div>
        <Button
          variant="link"
          onClick={() => {
            customer.setAccountPhone(form.getValues("phone"));
            switchTo("contact", otherContact ?? existingCustomer.otherContact);
          }}
          type="button"
        >
          {m.reservationBookForSomeoneElse({}, { locale })}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ReservationCustomerFields confirmsEmail locale={locale} />
      <Button
        variant="link"
        onClick={() => {
          const { name, email, phone } = form.getValues();
          customer.setOtherContact({ name, email, phone });
          switchTo(
            "account",
            getAccountContactValues(existingCustomer.contact, accountPhone)
          );
        }}
        type="button"
      >
        {m.reservationUseAccountDetails({}, { locale })}
      </Button>
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
      type="tel"
    />
  );
}

export function ReservationCustomerFields({
  confirmsEmail = false,
  fixedEmail = false,
  locale,
}: ReservationCustomerFieldsProps) {
  const emailField = (
    <ReservationTextField
      autoComplete="email"
      label={m.contactEmailLabel({}, { locale })}
      name="email"
      placeholder={m.contactEmailPlaceholder({}, { locale })}
      readOnly={fixedEmail}
      type="email"
    />
  );

  return (
    <>
      <ReservationTextField
        autoComplete="name"
        label={m.contactNameLabel({}, { locale })}
        name="name"
        placeholder={m.contactNamePlaceholder({}, { locale })}
      />
      {confirmsEmail ? (
        <>
          <div className="grid gap-5 md:grid-cols-2">
            {emailField}
            <ReservationTextField
              autoComplete="off"
              label={m.contactEmailConfirmationLabel({}, { locale })}
              name="emailConfirmation"
              placeholder={m.contactEmailPlaceholder({}, { locale })}
              type="email"
            />
          </div>
          <ReservationPhoneField locale={locale} />
        </>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {emailField}
          <ReservationPhoneField locale={locale} />
        </div>
      )}
    </>
  );
}

/**
 * The signed-in account couldn't be read, so the form can't tell whom it
 * books for. Retrying reloads the page's account with the selection kept.
 */
function ReservationAccountUnavailable({
  locale,
}: {
  readonly locale: Locale;
}) {
  const router = useRouter();
  const [isRetrying, startRetry] = useTransition();

  return (
    <section
      aria-labelledby="reservation-account-unavailable-heading"
      className="space-y-3 rounded-[1.4rem] border border-burned-orange/20 bg-burned-orange/8 p-4 sm:p-5"
      role="alert"
    >
      <h3
        className="flex items-center gap-2 text-base font-semibold text-burned-orange-ink"
        id="reservation-account-unavailable-heading"
      >
        <AlertTriangle
          aria-hidden="true"
          className="size-4 shrink-0 text-burned-orange"
        />
        {m.reservationAccountUnavailableTitle({}, { locale })}
      </h3>
      <p className="text-sm leading-6 text-navy-blue/72">
        {m.reservationAccountUnavailableBody({}, { locale })}
      </p>
      <Button
        disabled={isRetrying}
        onClick={() => startRetry(() => router.refresh())}
        size="sm"
        type="button"
        variant="secondary"
      >
        <RotateCw aria-hidden="true" className="size-4" />
        {m.reservationAccountUnavailableRetry({}, { locale })}
      </Button>
    </section>
  );
}

/**
 * Stops an account whose email matches Dotypos customers it can't safely
 * link: retrying can't help, so it points to support instead.
 */
function ReservationAccountSupportRequired({
  locale,
}: {
  readonly locale: Locale;
}) {
  return (
    <section
      aria-labelledby="reservation-account-support-heading"
      className="space-y-3 rounded-[1.4rem] border border-burned-orange/20 bg-burned-orange/8 p-4 sm:p-5"
      role="alert"
    >
      <h3
        className="flex items-center gap-2 text-base font-semibold text-burned-orange-ink"
        id="reservation-account-support-heading"
      >
        <AlertTriangle
          aria-hidden="true"
          className="size-4 shrink-0 text-burned-orange"
        />
        {m.reservationAccountSupportTitle({}, { locale })}
      </h3>
      <p className="text-sm leading-6 text-navy-blue/72">
        <Interpolate
          string={m.reservationAccountSupportBody({}, { locale })}
          mapping={{
            contact: (label) => (
              <Link
                className="font-semibold text-burned-orange underline underline-offset-4 transition-colors hover:text-chilean-fire"
                href={`/${locale}/contact`}
              >
                {label}
              </Link>
            ),
          }}
        />
      </p>
    </section>
  );
}

/**
 * Offers a returning customer the sign-in modal, which lands back on this
 * page with the current selection.
 */
function ReservationSignInPrompt({ locale }: { readonly locale: Locale }) {
  const pathname = usePathname();
  const searchParams = new URLSearchParams(useSearchParams());
  // A returning customer books with the saved profile, not typed details.
  searchParams.delete(checkoutContactQueryParam);
  const search = searchParams.toString();

  return (
    <p className="text-sm text-navy-blue/72">
      <Interpolate
        string={m.reservationSignInPrompt({}, { locale })}
        mapping={{
          signIn: (label) => (
            <Link
              className="font-semibold text-burned-orange underline underline-offset-4 transition-colors hover:text-chilean-fire"
              href={getAccountSignInPath(
                locale,
                search ? `${pathname}?${search}` : pathname
              )}
              scroll={false}
            >
              {label}
            </Link>
          ),
        }}
      />
    </p>
  );
}

export function ReservationContactHint({
  children,
}: {
  readonly children: ReactNode;
}) {
  return <p className="text-sm leading-6 text-navy-blue/64">{children}</p>;
}

function ReservationContactNotice({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <p className="flex items-start gap-3 rounded-2xl border border-navy-blue/12 bg-white/92 px-4 py-3 text-sm leading-6 text-navy-blue">
      <Info
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-burned-orange"
      />
      <span>{children}</span>
    </p>
  );
}

type ReservationTextFieldProps = {
  readonly autoComplete?: string;
  readonly label: string;
  readonly name: "email" | "emailConfirmation" | "name" | "phone";
  readonly placeholder: string;
  readonly readOnly?: boolean;
  readonly type?: "email" | "tel" | "text";
};

function ReservationTextField({
  autoComplete,
  label,
  name,
  placeholder,
  readOnly = false,
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
              className={
                readOnly ? "bg-navy-blue/5 text-navy-blue/72" : undefined
              }
              placeholder={placeholder}
              readOnly={readOnly}
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
