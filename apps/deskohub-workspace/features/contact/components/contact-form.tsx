"use client";

import { Send } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  type ContactFormState,
  type ContactFormValues,
  submitContactForm,
} from "@/features/contact/actions/contact";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import { cn } from "@/shared/utils";

type ContactFormProps = {
  locale: Locale;
  initialValues?: ContactFormInitialValues;
};

export type ContactFormInitialValues = Partial<ContactFormValues>;

const initialContactFormState: ContactFormState = {
  status: "idle",
};

const getContactQueryValue = (
  params: Pick<URLSearchParams, "get">,
  key: keyof ContactFormInitialValues,
  maxLength: number
) => params.get(key)?.slice(0, maxLength);

const getContactQueryInitialValues = (params: Pick<URLSearchParams, "get">) => {
  const values: ContactFormInitialValues = {
    name: getContactQueryValue(params, "name", 100),
    email: getContactQueryValue(params, "email", 255),
    phone: getContactQueryValue(params, "phone", 20),
    message: getContactQueryValue(params, "message", 1000),
  };

  return Object.values(values).some(Boolean) ? values : undefined;
};

export function ContactForm({ locale, initialValues }: ContactFormProps) {
  const [state, formAction] = useActionState(
    submitContactForm,
    initialContactFormState
  );
  const formRef = useRef<HTMLFormElement>(null);
  const [queryInitialValues, setQueryInitialValues] =
    useState<ContactFormInitialValues>();
  const fieldValues =
    state.status === "success"
      ? undefined
      : state.status === "error"
        ? state.values
        : (initialValues ?? queryInitialValues);
  const fieldRemountKey = fieldValues
    ? [
        fieldValues.name ?? "",
        fieldValues.email ?? "",
        fieldValues.phone ?? "",
        fieldValues.message ?? "",
      ]
        .map((value) => `${value.length}:${value}`)
        .join("|")
    : "clear";

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
    }
  }, [state.status]);

  return (
    <Card
      id="contact-form"
      className="relative overflow-hidden rounded-4xl border-white/50 bg-white/92 shadow-[0_40px_120px_-52px_rgba(0,2,79,0.55)] backdrop-blur-sm"
    >
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-linear-to-r from-transparent via-sunset-yellow/70 to-transparent" />
      <CardHeader className="space-y-3 pb-6">
        <CardTitle className="text-3xl sm:text-[2.2rem]">
          {m.contactFormTitle({}, { locale })}
        </CardTitle>
        <CardDescription className="max-w-xl text-base leading-7 text-navy-blue/72">
          {m.contactFormDescription({}, { locale })}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {!initialValues && (
          <Suspense fallback={null}>
            <ContactQueryInitialValuesSync onChange={setQueryInitialValues} />
          </Suspense>
        )}

        <form ref={formRef} action={formAction} className="space-y-5">
          <div key={fieldRemountKey} className="space-y-5">
            <div className="grid gap-5 md:grid-cols-2">
              <Field
                name="name"
                label={m.contactNameLabel({}, { locale })}
                placeholder={m.contactNamePlaceholder({}, { locale })}
                error={state.fieldErrors?.name}
                defaultValue={fieldValues?.name}
                autoComplete="name"
                required
              />
              <Field
                name="phone"
                label={m.contactPhoneLabel({}, { locale })}
                placeholder={m.contactPhonePlaceholder({}, { locale })}
                error={state.fieldErrors?.phone}
                defaultValue={fieldValues?.phone}
                autoComplete="tel"
              />
            </div>

            <Field
              name="email"
              type="email"
              label={m.contactEmailLabel({}, { locale })}
              placeholder={m.contactEmailPlaceholder({}, { locale })}
              error={state.fieldErrors?.email}
              defaultValue={fieldValues?.email}
              autoComplete="email"
              required
            />

            <Field
              name="message"
              label={m.contactMessageLabel({}, { locale })}
              placeholder={m.contactMessagePlaceholder({}, { locale })}
              error={state.fieldErrors?.message}
              defaultValue={fieldValues?.message}
              multiline
              required
            />
          </div>

          <div className="space-y-3 pt-2">
            <SubmitButton locale={locale} />

            <p className="text-sm leading-6 text-navy-blue/62">
              {m.contactPrivacyNoteBefore({}, { locale })}{" "}
              <Link
                href={`/${locale}/privacy-policy`}
                prefetch={false}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-burned-orange underline underline-offset-4 transition-colors hover:text-chilean-fire"
              >
                {m.contactPrivacyNoteLinkLabel({}, { locale })}
              </Link>{" "}
              {m.contactPrivacyNoteAfter({}, { locale })}
            </p>

            {!!state.message && (
              <p
                aria-live="polite"
                className={cn(
                  "rounded-2xl border px-4 py-3 text-sm leading-6",
                  state.status === "success"
                    ? "border-aquamarine-green/30 bg-aquamarine-green/10 text-navy-blue"
                    : "border-burned-orange/20 bg-burned-orange/8 text-navy-blue"
                )}
              >
                {state.message}
              </p>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function ContactQueryInitialValuesSync({
  onChange,
}: {
  readonly onChange: (values: ContactFormInitialValues | undefined) => void;
}) {
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();

  useEffect(() => {
    onChange(getContactQueryInitialValues(new URLSearchParams(queryString)));
  }, [onChange, queryString]);

  return null;
}

type FieldProps = {
  name: string;
  label: string;
  placeholder: string;
  error?: string;
  defaultValue?: string;
  type?: string;
  autoComplete?: string;
  multiline?: boolean;
  required?: boolean;
};

function Field({
  name,
  label,
  placeholder,
  error,
  defaultValue,
  type = "text",
  autoComplete,
  multiline = false,
  required = false,
}: FieldProps) {
  const inputId = `contact-${name}`;

  return (
    <div className="space-y-2">
      <Label
        htmlFor={inputId}
        className={cn(
          "text-sm font-semibold uppercase tracking-[0.14em] text-navy-blue/72",
          required && "after:content-['_*']"
        )}
      >
        {label}
      </Label>
      {multiline ? (
        <Textarea
          id={inputId}
          name={name}
          rows={7}
          placeholder={placeholder}
          defaultValue={defaultValue}
          className="min-h-40 resize-y rounded-[1.2rem]"
          variant={error ? "error" : "default"}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${name}-error` : undefined}
        />
      ) : (
        <Input
          id={inputId}
          name={name}
          type={type}
          autoComplete={autoComplete}
          placeholder={placeholder}
          defaultValue={defaultValue}
          className="rounded-[1.2rem]"
          variant={error ? "error" : "default"}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${name}-error` : undefined}
        />
      )}
      {!!error && (
        <span id={`${name}-error`} className="text-sm text-burned-orange">
          {error}
        </span>
      )}
    </div>
  );
}

function SubmitButton({ locale }: Pick<ContactFormProps, "locale">) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      className="h-13 w-full rounded-full text-sm uppercase tracking-[0.18em]"
      disabled={pending}
    >
      {pending ? (
        m.contactSubmitPending({}, { locale })
      ) : (
        <>
          <Send className="h-4 w-4" />
          {m.contactSubmitButton({}, { locale })}
        </>
      )}
    </Button>
  );
}
