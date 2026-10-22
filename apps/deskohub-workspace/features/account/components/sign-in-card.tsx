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
import { AuthCard } from "@/features/account/components/auth-card";
import { PasskeySignInOption } from "@/features/account/components/passkeys/passkey-sign-in-option";
import { signInEmailFailureMessage } from "@/features/account/components/sign-in-email-failure-message";
import { SignInEmailSentStep } from "@/features/account/components/sign-in-email-sent-step";
import { SignInPasswordStep } from "@/features/account/components/sign-in-password-step";
import {
  hasSignInCode,
  signsInWithPassword,
  useEmailSignInRequest,
} from "@/features/account/email-sign-in-request";
import type { SignInPurpose } from "@/features/account/routes";
import { type Locale, m } from "@/features/i18n";
import { useClientReady } from "@/shared/browser/use-client-ready";
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
import { parseSameOriginPath } from "@/shared/utils/same-origin-path";

type SignInCardProps = {
  readonly locale: Locale;
  /** Where to continue after sign-in; validated before use. */
  readonly returnTo?: string;
  /**
   * Offers passkey sign-in: the button below the form and passkey autofill
   * on the email field. Off while `login_passkeys` is off.
   */
  readonly passkeysEnabled?: boolean;
  /** Why the visitor signs in, when a page sent them here. */
  readonly purpose?: SignInPurpose;
  /**
   * Explains above the form that the sign-in a verify page waited for is
   * gone, until the visitor sends a new email.
   */
  readonly noLongerWaiting?: boolean;
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
  purpose,
  noLongerWaiting = false,
}: SignInCardProps) {
  const [failure, setFailure] = useState<SignInEmailFailure | null>(null);
  const [showNoLongerWaiting, setShowNoLongerWaiting] =
    useState(noLongerWaiting);
  const clientReady = useClientReady();
  // A server-rendered page shows the notice from the start. A client
  // navigation, such as the verify modal handing over, paints the notice's
  // live region empty for a frame first, since screen readers often skip a
  // region inserted together with its text.
  const [noticeRegionMounted, setNoticeRegionMounted] = useState(
    !clientReady || !noLongerWaiting
  );
  useEffect(() => {
    if (noticeRegionMounted) return;
    const frame = requestAnimationFrame(() => setNoticeRegionMounted(true));
    return () => cancelAnimationFrame(frame);
  }, [noticeRegionMounted]);
  const [storedRequest, setRequest] = useEmailSignInRequest();
  // The pending request continues only to its own destination: its link
  // already lands there. A card opened without one takes the request's; a
  // card opened for another one starts a fresh request.
  const requestedReturnTo = parseSameOriginPath(returnTo);
  const request =
    storedRequest &&
    (requestedReturnTo === undefined ||
      storedRequest.returnTo === requestedReturnTo)
      ? storedRequest
      : null;
  const destination = request ? request.returnTo : requestedReturnTo;
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
    () => createAuthReturnLifecycle({ locale, returnTo: destination }),
    [locale, destination]
  );
  const signInFormSchema = createSignInFormSchema(locale);
  const form = useForm<SignInFormInput, unknown, SignInFormValues>({
    defaultValues: { email: "" },
    mode: "onSubmit",
    reValidateMode: "onChange",
    resolver: effectSchemaResolver(signInFormSchema),
  });

  useEffect(() => authReturn.cancel, [authReturn]);

  const requestLink = async ({ email }: SignInFormValues) => {
    const result = await authReturn.sendSignInEmail(email);
    if (result.status === "cancelled") return;
    if (result.status === "failed") {
      setFailure(result.reason);
      return;
    }
    setShowNoLongerWaiting(false);
    if (result.status === "password") {
      setRequest({
        email,
        requestedAt: Date.now(),
        method: "password",
        returnTo: destination,
      });
      return;
    }
    if (!result.signInCode) focusAfterViewChange.current = "accepted";
    setRequest({
      email,
      requestedAt: Date.now(),
      signInCode: result.signInCode,
      attemptId: result.attemptId,
      returnTo: destination,
    });
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

  const changeEmail = (pending: NonNullable<typeof request>) => {
    authReturn.cancel();
    focusAfterViewChange.current = "email";
    setRequest(null);
    form.reset({
      email:
        hasSignInCode(pending) || signsInWithPassword(pending)
          ? pending.email
          : "",
    });
    setFailure(null);
  };

  if (request && signsInWithPassword(request)) {
    return (
      <AuthCard>
        <SignInPasswordStep
          locale={locale}
          authReturn={authReturn}
          request={request}
          onUseDifferentEmail={() => changeEmail(request)}
        />
      </AuthCard>
    );
  }

  if (request) {
    return (
      <AuthCard>
        <SignInEmailSentStep
          locale={locale}
          authReturn={authReturn}
          request={request}
          headingRef={focusOnMount("accepted")}
          onRequestChange={(next) => {
            if (!hasSignInCode(next)) focusAfterViewChange.current = "accepted";
            setRequest(next);
          }}
          onUseDifferentEmail={() => changeEmail(request)}
        />
      </AuthCard>
    );
  }

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
