"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { Send } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useStateAction } from "next-safe-action/stateful-hooks";
import type { FormEvent } from "react";
import {
  Suspense,
  useActionState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  type UseFormRegisterReturn,
  type UseFormReturn,
  useForm,
} from "react-hook-form";
import type { ContactFormState } from "@/features/contact/actions/contact";
import { submitContactForm } from "@/features/contact/actions/submit-contact";
import {
  type ContactFormValues,
  contactDefaultValues,
  getContactSchema,
} from "@/features/contact/schemas/contact";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import { cn } from "@/shared/utils";
import {
  hasContactActionOutcome,
  resolveContactFormState,
} from "./contact-form-state";

export type ContactFormClientProps = {
  readonly locale: Locale;
  readonly initialValues?: ContactFormInitialValues;
  readonly submitAction: typeof submitContactForm;
};

export type ContactFormInitialValues = Partial<ContactFormValues>;

export function ContactForm({
  initialValues,
  locale,
}: {
  readonly initialValues?: ContactFormInitialValues;
  readonly locale: Locale;
}) {
  return (
    <ContactFormClient
      initialValues={initialValues}
      locale={locale}
      submitAction={submitContactForm}
    />
  );
}

const haveSameContactValues = (
  left: ContactFormInitialValues | undefined,
  right: ContactFormInitialValues | undefined
) =>
  left === right ||
  (left !== undefined &&
    right !== undefined &&
    left.name === right.name &&
    left.email === right.email &&
    left.phone === right.phone &&
    left.message === right.message);

const getContactFormValues = (
  values?: ContactFormInitialValues
): ContactFormValues => ({
  name: values?.name ?? contactDefaultValues.name,
  email: values?.email ?? contactDefaultValues.email,
  phone: values?.phone ?? contactDefaultValues.phone,
  message: values?.message ?? contactDefaultValues.message,
});

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

export function ContactFormClient({
  initialValues,
  locale,
  submitAction,
}: ContactFormClientProps) {
  const [queryInitialValues, setQueryInitialValues] =
    useState<ContactFormInitialValues>();
  const syncQueryInitialValues = useCallback(
    (values: ContactFormInitialValues | undefined) => {
      setQueryInitialValues((current) =>
        haveSameContactValues(current, values) ? current : values
      );
    },
    []
  );
  const formMethodsRef = useRef<UseFormReturn<ContactFormValues> | undefined>(
    undefined
  );
  const action = useStateAction(submitAction, {
    onSuccess: ({ data }) => {
      if (data.status === "success") {
        formMethodsRef.current?.reset(contactDefaultValues, {
          keepFieldsRef: true,
        });
      } else if (data.status === "error" && data.values) {
        formMethodsRef.current?.reset(data.values, { keepFieldsRef: true });
      }
    },
  });
  const [nativeResult, nativeFormAction] = useActionState(submitAction, {});
  const previousNativeResult = useRef(nativeResult);
  const hydratedHasOutcome = hasContactActionOutcome(action.result);
  const state: ContactFormState = resolveContactFormState(
    action.result,
    nativeResult,
    m.contactEmailSendError({}, { locale })
  );
  let fieldValues = initialValues ?? queryInitialValues;
  if (state.status === "error") {
    fieldValues = state.values ?? fieldValues;
  } else if (state.status === "success") {
    fieldValues = undefined;
  }
  const reactiveValues =
    !hydratedHasOutcome && state.status === "idle"
      ? getContactFormValues(fieldValues)
      : undefined;

  // RHF caches defaultValues; synchronize only a new native result after mount.
  useLayoutEffect(() => {
    if (hydratedHasOutcome || previousNativeResult.current === nativeResult)
      return;
    previousNativeResult.current = nativeResult;

    if (nativeResult.data?.status === "success") {
      formMethodsRef.current?.reset(contactDefaultValues, {
        keepFieldsRef: true,
      });
    } else if (
      nativeResult.data?.status === "error" &&
      nativeResult.data.values
    ) {
      formMethodsRef.current?.reset(nativeResult.data.values, {
        keepFieldsRef: true,
      });
    }
  }, [hydratedHasOutcome, nativeResult]);

  return (
    <Card
      id="contact-form"
      className="relative overflow-hidden rounded-4xl border-white/50 bg-white/92 shadow-[0_40px_120px_-52px_rgba(0,2,79,0.55)] backdrop-blur-sm"
    >
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-linear-to-r from-transparent via-sunset-yellow/70 to-transparent" />
      <CardHeader className="pb-6">
        <CardTitle as="h2" className="text-3xl sm:text-[2.2rem]">
          {m.contactFormTitle({}, { locale })}
        </CardTitle>
      </CardHeader>

      <CardContent>
        {!initialValues && (
          <Suspense fallback={null}>
            <ContactQueryInitialValuesSync onChange={syncQueryInitialValues} />
          </Suspense>
        )}

        <ContactFormBody
          actionIsExecuting={action.isExecuting}
          defaultValues={fieldValues}
          execute={action.execute}
          formMethodsRef={formMethodsRef}
          locale={locale}
          nativeFormAction={nativeFormAction}
          reactiveValues={reactiveValues}
          state={state}
        />
      </CardContent>
    </Card>
  );
}

function ContactFormBody({
  actionIsExecuting,
  defaultValues,
  execute,
  formMethodsRef,
  locale,
  nativeFormAction,
  reactiveValues,
  state,
}: {
  readonly actionIsExecuting: boolean;
  readonly defaultValues?: ContactFormInitialValues;
  readonly execute: (formData: FormData) => void;
  readonly formMethodsRef: {
    current: UseFormReturn<ContactFormValues> | undefined;
  };
  readonly locale: Locale;
  readonly nativeFormAction: (formData: FormData) => void;
  readonly reactiveValues?: ContactFormValues;
  readonly state: ContactFormState;
}) {
  const resolver = effectSchemaResolver(getContactSchema(locale));
  const form = useForm<ContactFormValues>({
    defaultValues: getContactFormValues(defaultValues),
    resolver,
    values: reactiveValues,
  });
  const { formState, register } = form;
  const formRef = useRef<HTMLFormElement>(null);

  useLayoutEffect(() => {
    formMethodsRef.current = form;
    if (formState.isReady) {
      formRef.current?.setAttribute("data-rhf-ready", "true");
    }
  }, [form, formMethodsRef, formState.isReady]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    const formData = new FormData(event.currentTarget);
    void form.handleSubmit(() => execute(formData))(event);
  };

  const hasClientValidationError =
    formState.isSubmitted && !formState.isSubmitSuccessful;
  const resultMessage = hasClientValidationError
    ? m.contactValidationReviewMessage({}, { locale })
    : state.message;
  const message =
    formState.isSubmitting || actionIsExecuting ? undefined : resultMessage;
  const isSuccessMessage =
    !hasClientValidationError && state.status === "success";

  return (
    <form
      action={nativeFormAction}
      className="space-y-5"
      noValidate
      onSubmit={handleSubmit}
      ref={formRef}
    >
      <input type="hidden" name="locale" value={locale} />
      <div className="space-y-5">
        <div className="grid gap-5 md:grid-cols-2">
          <Field
            name="name"
            registration={register("name")}
            label={m.contactNameLabel({}, { locale })}
            placeholder={m.contactNamePlaceholder({}, { locale })}
            defaultValue={defaultValues?.name}
            error={formState.errors.name?.message ?? state.fieldErrors?.name}
            autoComplete="name"
            maxLength={100}
            minLength={2}
            required
          />
          <Field
            name="phone"
            registration={register("phone")}
            label={m.contactPhoneLabel({}, { locale })}
            placeholder={m.contactPhonePlaceholder({}, { locale })}
            defaultValue={defaultValues?.phone}
            error={formState.errors.phone?.message ?? state.fieldErrors?.phone}
            autoComplete="tel"
            maxLength={20}
          />
        </div>

        <Field
          name="email"
          registration={register("email")}
          type="email"
          label={m.contactEmailLabel({}, { locale })}
          placeholder={m.contactEmailPlaceholder({}, { locale })}
          defaultValue={defaultValues?.email}
          error={formState.errors.email?.message ?? state.fieldErrors?.email}
          autoComplete="email"
          maxLength={255}
          required
        />

        <Field
          name="message"
          registration={register("message")}
          label={m.contactMessageLabel({}, { locale })}
          placeholder={m.contactMessagePlaceholder({}, { locale })}
          defaultValue={defaultValues?.message}
          error={
            formState.errors.message?.message ?? state.fieldErrors?.message
          }
          multiline
          maxLength={1000}
          minLength={10}
          required
        />
      </div>

      <div className="space-y-3 pt-2">
        <SubmitButton
          locale={locale}
          pending={formState.isSubmitting || actionIsExecuting}
        />

        <p className="text-sm leading-6 text-navy-blue/62">
          {m.contactPrivacyNoteBefore({}, { locale })}{" "}
          <Link
            href={`/${locale}/privacy-policy`}
            prefetch={false}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-burned-orange underline underline-offset-4 transition-colors hover:text-burned-orange-ink"
          >
            {m.contactPrivacyNoteLinkLabel({}, { locale })}
          </Link>{" "}
          {m.contactPrivacyNoteAfter({}, { locale })}
        </p>

        {!!message && (
          <p
            aria-live="polite"
            className={cn(
              "rounded-2xl border px-4 py-3 text-sm leading-6",
              isSuccessMessage
                ? "border-aquamarine-green/30 bg-aquamarine-green/10 text-aquamarine-ink"
                : "border-burned-orange/20 bg-burned-orange/8 text-burned-orange-ink"
            )}
          >
            {message}
          </p>
        )}
      </div>
    </form>
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
  name: keyof ContactFormValues;
  registration: UseFormRegisterReturn;
  label: string;
  placeholder: string;
  error?: string;
  defaultValue?: string;
  type?: string;
  autoComplete?: string;
  maxLength?: number;
  minLength?: number;
  multiline?: boolean;
  required?: boolean;
};

function Field({
  name,
  registration,
  label,
  placeholder,
  error,
  defaultValue,
  type = "text",
  autoComplete,
  maxLength,
  minLength,
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
          {...registration}
          id={inputId}
          rows={7}
          placeholder={placeholder}
          defaultValue={defaultValue}
          className="min-h-40 resize-y rounded-[1.2rem]"
          variant={error ? "error" : "default"}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${name}-error` : undefined}
          maxLength={maxLength}
          minLength={minLength}
          required={required}
        />
      ) : (
        <Input
          {...registration}
          id={inputId}
          type={type}
          autoComplete={autoComplete}
          placeholder={placeholder}
          defaultValue={defaultValue}
          className="rounded-[1.2rem]"
          variant={error ? "error" : "default"}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${name}-error` : undefined}
          maxLength={maxLength}
          minLength={minLength}
          required={required}
        />
      )}
      {!!error && (
        <span
          id={`${name}-error`}
          role="alert"
          className="text-sm text-burned-orange"
        >
          {error}
        </span>
      )}
    </div>
  );
}

function SubmitButton({
  locale,
  pending,
}: Pick<ContactFormClientProps, "locale"> & { pending: boolean }) {
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
