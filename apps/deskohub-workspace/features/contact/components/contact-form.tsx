"use client";

import { Send } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import {
  type ContactFormState,
  submitContactForm,
} from "@/features/contact/actions/contact";
import { m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { cn } from "@/shared/utils";

const fieldBaseClassName =
  "w-full rounded-[1.2rem] border border-navy-blue/12 bg-white px-4 py-3 text-base text-navy-blue outline-none transition focus:border-burned-orange focus:ring-4 focus:ring-burned-orange/10";

type ContactFormProps = {
  locale: "en-US" | "cs-CZ";
};

const initialContactFormState: ContactFormState = {
  status: "idle",
};

export function ContactForm({ locale }: ContactFormProps) {
  const [state, formAction] = useActionState(
    submitContactForm,
    initialContactFormState
  );
  const formRef = useRef<HTMLFormElement>(null);
  const fieldValues = state.status === "error" ? state.values : undefined;
  const fieldRemountKey = fieldValues
    ? [
        fieldValues.name,
        fieldValues.email,
        fieldValues.phone,
        fieldValues.message,
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
    <Card className="relative overflow-hidden rounded-[2rem] border-white/50 bg-white/92 shadow-[0_40px_120px_-52px_rgba(0,2,79,0.55)] backdrop-blur-sm">
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-sunset-yellow/70 to-transparent" />
      <CardHeader className="space-y-3 pb-6">
        <CardTitle className="text-3xl sm:text-[2.2rem]">
          {m.contactFormTitle({}, { locale })}
        </CardTitle>
        <CardDescription className="max-w-xl text-base leading-7 text-navy-blue/72">
          {m.contactFormDescription({}, { locale })}
        </CardDescription>
      </CardHeader>

      <CardContent>
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
            />

            <Field
              name="message"
              label={m.contactMessageLabel({}, { locale })}
              placeholder={m.contactMessagePlaceholder({}, { locale })}
              error={state.fieldErrors?.message}
              defaultValue={fieldValues?.message}
              multiline
            />
          </div>

          <div className="space-y-3 pt-2">
            <SubmitButton locale={locale} />

            <p className="text-sm leading-6 text-navy-blue/62">
              {m.contactPrivacyNoteBefore({}, { locale })}{" "}
              <Link
                href={`/${locale}/privacy-policy`}
                className="font-semibold text-burned-orange underline underline-offset-4 transition-colors hover:text-chilean-fire"
              >
                {m.contactPrivacyNoteLinkLabel({}, { locale })}
              </Link>{" "}
              {m.contactPrivacyNoteAfter({}, { locale })}
            </p>

            {state.message ? (
              <p
                aria-live="polite"
                className={cn(
                  "rounded-[1rem] border px-4 py-3 text-sm leading-6",
                  state.status === "success"
                    ? "border-aquamarine-green/30 bg-aquamarine-green/10 text-navy-blue"
                    : "border-burned-orange/20 bg-burned-orange/8 text-navy-blue"
                )}
              >
                {state.message}
              </p>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
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
}: FieldProps) {
  const inputId = `contact-${name}`;

  return (
    <label htmlFor={inputId} className="block space-y-2">
      <span className="block text-sm font-semibold uppercase tracking-[0.14em] text-navy-blue/72">
        {label}
      </span>
      {multiline ? (
        <textarea
          id={inputId}
          name={name}
          rows={7}
          placeholder={placeholder}
          defaultValue={defaultValue}
          className={cn(
            fieldBaseClassName,
            "min-h-40 resize-y",
            error && "border-burned-orange ring-4 ring-burned-orange/10"
          )}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${name}-error` : undefined}
        />
      ) : (
        <input
          id={inputId}
          name={name}
          type={type}
          autoComplete={autoComplete}
          placeholder={placeholder}
          defaultValue={defaultValue}
          className={cn(
            fieldBaseClassName,
            error && "border-burned-orange ring-4 ring-burned-orange/10"
          )}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${name}-error` : undefined}
        />
      )}
      {error ? (
        <span id={`${name}-error`} className="text-sm text-burned-orange">
          {error}
        </span>
      ) : null}
    </label>
  );
}

function SubmitButton({ locale }: ContactFormProps) {
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
