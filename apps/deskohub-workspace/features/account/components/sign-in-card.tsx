"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { Schema } from "effect";
import { Loader2 } from "lucide-react";
import type { FormEvent } from "react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useForm } from "react-hook-form";
import isEmail from "validator/lib/isEmail.js";
import { createAuthReturnLifecycle } from "@/features/account/auth-return";
import { type Locale, m } from "@/features/i18n";
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

type SignInCardProps = {
  readonly locale: Locale;
};

const signInEmailMaximumLength = 255;
const subscribeToClientReady = () => () => undefined;
const getClientReadySnapshot = () => true;
const getServerClientReadySnapshot = () => false;

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

export function SignInCard({ locale }: SignInCardProps) {
  const [requested, setRequested] = useState(false);
  const [failed, setFailed] = useState(false);
  const clientReady = useSyncExternalStore(
    subscribeToClientReady,
    getClientReadySnapshot,
    getServerClientReadySnapshot
  );
  const submissionInProgress = useRef(false);
  const authReturn = useMemo(
    () => createAuthReturnLifecycle({ locale }),
    [locale]
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
    try {
      const result = await authReturn.sendMagicLink(email);
      if (result.error) {
        setFailed(true);
        return;
      }
      setRequested(true);
    } catch {
      setFailed(true);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (submissionInProgress.current) {
      event.preventDefault();
      return;
    }
    submissionInProgress.current = true;
    setFailed(false);
    void form
      .handleSubmit(requestLink)(event)
      .finally(() => {
        submissionInProgress.current = false;
      });
  };

  if (requested) {
    return (
      <Card className="rounded-3xl border-white/70 bg-white/94 shadow-[0_32px_100px_-48px_rgba(0,2,79,0.55)]">
        <CardContent className="p-8 sm:p-10">
          <h2 className="text-3xl text-navy-blue">
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
              form.reset();
              setFailed(false);
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
                  <FormControl>
                    <Input
                      {...field}
                      disabled={!clientReady}
                      id="account-sign-in-email"
                      type="email"
                      required
                      autoComplete="email"
                      placeholder={m.accountSignInEmailPlaceholder(
                        {},
                        { locale }
                      )}
                    />
                  </FormControl>
                  <FormMessage className="text-sm font-normal text-red-700" />
                </FormItem>
              )}
            />
            <SignInSubmitButton
              locale={locale}
              pending={form.formState.isSubmitting}
              ready={clientReady}
            />
          </form>
        </Form>
        <div aria-live="polite" className="mt-4 min-h-5 text-sm text-red-700">
          {failed ? m.accountSignInRequestFailed({}, { locale }) : null}
        </div>
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
      type="submit"
      disabled={!ready || pending}
      aria-busy={pending}
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
