"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { Schema } from "effect";
import { Loader2 } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import isEmail from "validator/lib/isEmail.js";
import {
  createAuthReturnLifecycle,
  type SignInEmailFailure,
} from "@/features/account/auth-return";
import { PasskeySignInOption } from "@/features/account/components/passkeys/passkey-sign-in-option";
import { SignInCodeStep } from "@/features/account/components/sign-in-code-step";
import { signInEmailFailureMessage } from "@/features/account/components/sign-in-email-failure-message";
import { useSignInCodeRequest } from "@/features/account/sign-in-code-request";
import { type Locale, m } from "@/features/i18n";
import { useClientReady } from "@/shared/browser/use-client-ready";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shared/components/ui/form";
import { Input } from "@/shared/components/ui/input";
import { maskEmailAddress } from "@/shared/utils";

type SignInCardProps = {
  readonly locale: Locale;
  /** Where to continue after sign-in; validated before use. */
  readonly returnTo?: string;
  /**
   * Offers passkey sign-in: the button below the form and passkey autofill
   * on the email field. Off while `login_passkeys` is off.
   */
  readonly passkeysEnabled?: boolean;
};

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
type SignInFormValues = SignInFormSchema["Type"];

export function SignInCard({
  locale,
  returnTo,
  passkeysEnabled = false,
}: SignInCardProps) {
  const [requested, setRequested] = useState(false);
  const [failure, setFailure] = useState<SignInEmailFailure | null>(null);
  const [codeRequest, setCodeRequest] = useSignInCodeRequest();
  const clientReady = useClientReady();
  const submissionInProgress = useRef(false);
  // The control that switched the view unmounts with it, so the next view
  // takes focus once it mounts.
  const focusAfterViewChange = useRef<"email" | "accepted" | null>(null);
  const focusOnMount =
    (target: "email" | "accepted") => (element: HTMLElement | null) => {
      if (element === null || focusAfterViewChange.current !== target) return;
      focusAfterViewChange.current = null;
      element.focus();
    };
  const authReturn = useMemo(
    () => createAuthReturnLifecycle({ locale, returnTo }),
    [locale, returnTo]
  );
  const signInFormSchema = createSignInFormSchema(locale);
  const form = useForm<SignInFormInput, unknown, SignInFormValues>({
    defaultValues: { email: "" },
    mode: "onSubmit",
    reValidateMode: "onChange",
    resolver: effectSchemaResolver(signInFormSchema),
  });

  useEffect(() => authReturn.cancel, [authReturn]);

  // The link may be opened in another tab after this one reloaded and lost
  // its hand-off listener; coming back to this tab then continues.
  useEffect(() => {
    if (!codeRequest) return;
    const continueIfSignedIn = () => {
      if (document.visibilityState !== "visible") return;
      void authReturn.continueIfSignedIn();
    };
    window.addEventListener("focus", continueIfSignedIn);
    document.addEventListener("visibilitychange", continueIfSignedIn);
    return () => {
      window.removeEventListener("focus", continueIfSignedIn);
      document.removeEventListener("visibilitychange", continueIfSignedIn);
    };
  }, [authReturn, codeRequest]);

  const requestLink = async ({ email }: SignInFormValues) => {
    const result = await authReturn.sendSignInEmail(email);
    if (result.status === "cancelled") return;
    if (result.status === "failed") {
      setFailure(result.reason);
      return;
    }
    if (result.signInCode) {
      setCodeRequest({ email, requestedAt: Date.now() });
      return;
    }
    focusAfterViewChange.current = "accepted";
    setRequested(true);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (submissionInProgress.current) {
      event.preventDefault();
      return;
    }
    submissionInProgress.current = true;
    setFailure(null);
    void form
      .handleSubmit(requestLink)(event)
      .finally(() => {
        submissionInProgress.current = false;
      });
  };

  if (codeRequest) {
    const requestNewEmail = async () => {
      const result = await authReturn.sendSignInEmail(codeRequest.email);
      // "Use a different email" or a newer email replaced this request.
      if (result.status === "cancelled") return result.status;
      if (result.status === "failed") return result.reason;
      if (result.signInCode) {
        setCodeRequest({ email: codeRequest.email, requestedAt: Date.now() });
      } else {
        // Codes were switched off meanwhile: fall back to the link-only state.
        focusAfterViewChange.current = "accepted";
        setCodeRequest(null);
        setRequested(true);
      }
      return "sent" as const;
    };

    return (
      <Card className="rounded-3xl border-white/70 bg-white/94 shadow-[0_32px_100px_-48px_rgba(0,2,79,0.55)]">
        <CardContent className="p-8 sm:p-10">
          <h2 className="text-3xl text-navy-blue">
            {m.accountSignInCodeTitle({}, { locale })}
          </h2>
          <p className="mt-3 text-sm leading-6 text-navy-blue/68">
            {m.accountSignInCodeBody(
              { email: maskEmailAddress(codeRequest.email) },
              { locale }
            )}
          </p>
          <SignInCodeStep
            locale={locale}
            requestedAt={codeRequest.requestedAt}
            verifiedMessage={m.accountSignInCodeVerified({}, { locale })}
            verifyCode={(code) =>
              authReturn.verifySignInCode(codeRequest.email, code)
            }
            onVerified={authReturn.continueWithVerifiedCode}
            requestNewEmail={requestNewEmail}
            onUseDifferentEmail={() => {
              authReturn.cancel();
              focusAfterViewChange.current = "email";
              setCodeRequest(null);
              form.reset({ email: codeRequest.email });
              setFailure(null);
            }}
          />
        </CardContent>
      </Card>
    );
  }

  if (requested) {
    return (
      <Card className="rounded-3xl border-white/70 bg-white/94 shadow-[0_32px_100px_-48px_rgba(0,2,79,0.55)]">
        <CardContent className="p-8 sm:p-10">
          <h2
            ref={focusOnMount("accepted")}
            tabIndex={-1}
            className="text-3xl text-navy-blue outline-none"
          >
            {m.accountSignInAcceptedTitle({}, { locale })}
          </h2>
          <p className="mt-4 leading-7 text-navy-blue/68">
            {m.accountSignInAcceptedBody({}, { locale })}
          </p>
          <Button
            type="button"
            variant="secondary"
            className="mt-8"
            onClick={() => {
              authReturn.cancel();
              focusAfterViewChange.current = "email";
              form.reset();
              setFailure(null);
              setRequested(false);
            }}
          >
            {m.accountSignInAcceptedAgain({}, { locale })}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-3xl border-white/70 bg-white/94 shadow-[0_32px_100px_-48px_rgba(0,2,79,0.55)]">
      <CardContent className="p-8 sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-burned-orange">
          {m.accountSignInEyebrow({}, { locale })}
        </p>
        <h1 className="mt-3 text-3xl text-navy-blue">
          {m.accountSignInTitle({}, { locale })}
        </h1>
        <p className="mt-3 text-sm leading-6 text-navy-blue/68">
          {m.accountSignInDescription({}, { locale })}
        </p>
        <Form {...form}>
          <form
            id="account-sign-in-form"
            className="mt-8 space-y-5"
            method="post"
            noValidate
            onSubmit={handleSubmit}
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
                    <FormControl>
                      <Input
                        className="min-w-0 sm:flex-1"
                        {...field}
                        ref={(element) => {
                          field.ref(element);
                          focusOnMount("email")(element);
                        }}
                        disabled={!clientReady}
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
                      ready={clientReady}
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
            ready={clientReady}
            returnTo={returnTo}
          />
        )}
      </CardContent>
    </Card>
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
