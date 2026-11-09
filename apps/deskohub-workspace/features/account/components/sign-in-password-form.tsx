"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { Schema } from "effect";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { PasswordSignIn } from "@/features/account/auth-return";
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
import { cn } from "@/shared/utils";

const createPasswordFormSchema = (locale: Locale) =>
  Schema.Struct({
    password: Schema.String.check(
      Schema.isNonEmpty({
        message: m.accountSignInPasswordRequired({}, { locale }),
      })
    ),
  });

type PasswordFormSchema = ReturnType<typeof createPasswordFormSchema>;
type PasswordFormInput = PasswordFormSchema["Encoded"];
type PasswordFormValues = PasswordFormSchema["Type"];

type SignInPasswordFormProps = {
  readonly locale: Locale;
  /** The review login's address, offered to password managers. */
  readonly email: string;
  readonly signedInMessage: string;
  readonly signIn: (password: string) => Promise<PasswordSignIn>;
  readonly onSignedIn: () => void;
  readonly onUseDifferentEmail?: () => void;
};

/**
 * Password entry for an app-directory review login, shared by sign-in and
 * reauthentication. The caller renders the heading and description. Only an
 * address the server named a review login reaches it, so customers never
 * see a password field.
 */
export function SignInPasswordForm({
  locale,
  email,
  signedInMessage,
  signIn,
  onSignedIn,
  onUseDifferentEmail,
}: SignInPasswordFormProps) {
  const [outcome, setOutcome] = useState<PasswordSignIn | null>(null);
  const form = useForm<PasswordFormInput, unknown, PasswordFormValues>({
    defaultValues: { password: "" },
    mode: "onSubmit",
    reValidateMode: "onChange",
    resolver: effectSchemaResolver(createPasswordFormSchema(locale)),
  });

  const submit = async ({ password }: PasswordFormValues) => {
    setOutcome(null);
    const result = await signIn(password);
    if (result === "signed-in") {
      setOutcome(result);
      onSignedIn();
      return;
    }
    form.resetField("password");
    if (result === "wrong") {
      form.setError(
        "password",
        { message: m.accountSignInPasswordWrong({}, { locale }) },
        { shouldFocus: true }
      );
      return;
    }
    setOutcome(result);
    form.setFocus("password");
  };

  const pending = form.formState.isSubmitting;
  const signedIn = outcome === "signed-in";

  return (
    <div className="mt-8">
      <Form {...form}>
        <form
          id="account-sign-in-password-form"
          className="space-y-5"
          method="post"
          noValidate
          onSubmit={form.handleSubmit(submit)}
        >
          {/* Password managers pair the saved password with this address. */}
          <input
            type="email"
            name="email"
            autoComplete="username"
            value={email}
            readOnly
            hidden
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem className="space-y-2">
                <FormLabel htmlFor="account-sign-in-password">
                  {m.accountSignInPasswordLabel({}, { locale })}
                </FormLabel>
                <FormControl aria-describedby="account-sign-in-password-status">
                  <Input
                    {...field}
                    id="account-sign-in-password"
                    type="password"
                    autoComplete="current-password"
                    // The step opens right after the email, so typing goes on.
                    autoFocus
                    required
                    disabled={signedIn}
                  />
                </FormControl>
                <FormMessage className="text-sm font-normal text-red-700" />
              </FormItem>
            )}
          />
          <Button
            id="account-sign-in-password-submit"
            fullWidth
            size="lg"
            type="submit"
            disabled={signedIn}
            pending={pending}
          >
            {pending && (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            )}
            {pending
              ? m.accountSignInPasswordSubmitting({}, { locale })
              : m.accountSignInPasswordSubmit({}, { locale })}
          </Button>
        </form>
      </Form>
      <div
        id="account-sign-in-password-status"
        aria-live="polite"
        className={cn(
          "mt-3 flex min-h-5 items-start gap-2 text-sm leading-5",
          signedIn ? "text-aquamarine-ink" : "text-red-700"
        )}
      >
        {signedIn && (
          <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        )}
        {outcome !== null &&
          {
            "signed-in": () => signedInMessage,
            wrong: () => null,
            "rate-limited": () => m.accountSignInRateLimited({}, { locale }),
            automated: () => m.accountSignInAutomatedRequest({}, { locale }),
            failed: () => m.accountSignInPasswordFailed({}, { locale }),
          }[outcome]()}
      </div>
      {onUseDifferentEmail && (
        <Button
          type="button"
          variant="link"
          className="mt-4"
          disabled={pending || signedIn}
          onClick={onUseDifferentEmail}
        >
          {m.accountSignInCodeChangeEmail({}, { locale })}
        </Button>
      )}
    </div>
  );
}
