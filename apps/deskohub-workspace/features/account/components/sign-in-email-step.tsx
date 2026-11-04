"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { Schema } from "effect";
import { Loader2 } from "lucide-react";
import type { FormEvent } from "react";
import { type UseFormReturn, useForm } from "react-hook-form";
import isEmail from "validator/lib/isEmail.js";
import type { SignInEmailFailure } from "@/features/account/auth-return";
import { AuthCard } from "@/features/account/components/auth-card";
import { PasskeySignInOption } from "@/features/account/components/passkeys/passkey-sign-in-option";
import { signInEmailFailureMessage } from "@/features/account/components/sign-in-email-failure-message";
import type { SignInPurpose } from "@/features/account/routes";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shared/components/ui/form";
import { Input } from "@/shared/components/ui/input";

const signInEmailMaximumLength = 255;

const createSignInFormSchema = (locale: Locale) =>
  Schema.Struct({
    email: Schema.Trim.check(
      Schema.isNonEmpty({
        message: m.contactValidationEmailRequired({}, { locale }),
      }),
      Schema.isMaxLength(signInEmailMaximumLength, {
        message: m.contactValidationEmailMaximum(
          { max: signInEmailMaximumLength },
          { locale }
        ),
      }),
      Schema.makeFilter((value) => isEmail(value), {
        message: m.contactValidationEmailInvalid({}, { locale }),
      })
    ),
  });

type SignInFormSchema = ReturnType<typeof createSignInFormSchema>;
type SignInFormInput = SignInFormSchema["Encoded"];
export type SignInFormValues = SignInFormSchema["Type"];

export type SignInEmailForm = UseFormReturn<
  SignInFormInput,
  unknown,
  SignInFormValues
>;

/** The sign-in email form, validated in the visitor's locale on submit. */
export function useSignInEmailForm(locale: Locale): SignInEmailForm {
  return useForm<SignInFormInput, unknown, SignInFormValues>({
    defaultValues: { email: "" },
    mode: "onSubmit",
    reValidateMode: "onChange",
    resolver: effectSchemaResolver(createSignInFormSchema(locale)),
  });
}

type SignInEmailStepProps = {
  readonly locale: Locale;
  readonly form: SignInEmailForm;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  /** Receives the email field, which takes focus after a view change. */
  readonly emailRef: (element: HTMLElement | null) => void;
  readonly ready: boolean;
  readonly failure: SignInEmailFailure | null;
  readonly passkeysEnabled: boolean;
  readonly purpose: SignInPurpose | undefined;
  readonly returnTo: string | undefined;
  /** Shows the no-longer-waiting notice and describes the field with it. */
  readonly showNoLongerWaiting: boolean;
  /** Whether the notice's live region may show its text yet. */
  readonly noticeRegionMounted: boolean;
};

/**
 * The email step of sign-in: the form that sends the sign-in email, its
 * failure, and the passkey option while passkeys are on.
 */
export function SignInEmailStep({
  locale,
  form,
  onSubmit,
  emailRef,
  ready,
  failure,
  passkeysEnabled,
  purpose,
  returnTo,
  showNoLongerWaiting,
  noticeRegionMounted,
}: SignInEmailStepProps) {
  return (
    <AuthCard>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-burned-orange">
        {m.accountSignInEyebrow({}, { locale })}
      </p>
      <h1 className="mt-3 text-3xl text-navy-blue">
        {{
          none: m.accountSignInTitle,
          reservation: m.accountSignInReservationTitle,
          assistant: m.customerAgentSignInTitle,
        }[purpose ?? "none"]({}, { locale })}
      </h1>
      <p className="mt-3 text-sm leading-6 text-navy-blue/68">
        {{
          none: m.accountSignInDescription,
          reservation: m.accountSignInReservationDescription,
          assistant: m.customerAgentSignInDescription,
        }[purpose ?? "none"]({}, { locale })}
      </p>
      <div id="account-sign-in-notice" role="status">
        {showNoLongerWaiting && noticeRegionMounted && (
          <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
            {m.accountSignInNoLongerWaitingNotice({}, { locale })}
          </p>
        )}
      </div>
      <Form {...form}>
        <form
          id="account-sign-in-form"
          className="mt-8 space-y-5"
          method="post"
          noValidate
          onSubmit={onSubmit}
        >
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem className="space-y-2">
                <FormLabel htmlFor="account-sign-in-email">
                  {m.accountSignInEmailLabel({}, { locale })}
                </FormLabel>
                {/* The button joins the input's row once it fits beside it. */}
                <div className="flex flex-col gap-3 sm:flex-row">
                  <FormControl
                    aria-describedby={
                      showNoLongerWaiting ? "account-sign-in-notice" : undefined
                    }
                  >
                    <Input
                      className="min-w-0 sm:flex-1"
                      {...field}
                      ref={(element) => {
                        field.ref(element);
                        emailRef(element);
                      }}
                      disabled={!ready}
                      id="account-sign-in-email"
                      type="email"
                      required
                      autoComplete={
                        passkeysEnabled ? "email webauthn" : "email"
                      }
                      placeholder={m.accountSignInEmailPlaceholder(
                        {},
                        { locale }
                      )}
                    />
                  </FormControl>
                  <SignInSubmitButton
                    locale={locale}
                    pending={form.formState.isSubmitting}
                    ready={ready}
                  />
                </div>
                <FormMessage className="text-sm font-normal text-red-700" />
              </FormItem>
            )}
          />
        </form>
      </Form>
      <div aria-live="polite" className="mt-4 min-h-5 text-sm text-red-700">
        {failure && signInEmailFailureMessage(failure, locale)}
      </div>
      {passkeysEnabled && (
        <PasskeySignInOption
          locale={locale}
          ready={ready}
          returnTo={returnTo}
        />
      )}
    </AuthCard>
  );
}

function SignInSubmitButton({
  locale,
  pending,
  ready,
}: {
  readonly locale: Locale;
  readonly pending: boolean;
  readonly ready: boolean;
}) {
  return (
    <Button
      id="account-sign-in-submit"
      className="sm:w-auto sm:shrink-0"
      fullWidth
      size="lg"
      type="submit"
      disabled={!ready}
      pending={pending}
    >
      {pending ? (
        <>
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          {m.accountSignInSubmitting({}, { locale })}
        </>
      ) : (
        m.accountSignInSubmit({}, { locale })
      )}
    </Button>
  );
}
