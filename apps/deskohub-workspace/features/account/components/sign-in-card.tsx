"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { authClient } from "@/features/account/auth.client";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";

type SignInCardProps = {
  readonly locale: Locale;
};

export function SignInCard({ locale }: SignInCardProps) {
  const [requested, setRequested] = useState(false);
  const [failed, setFailed] = useState(false);

  const requestLink = async (formData: FormData) => {
    const email = String(formData.get("email") ?? "").trim();
    if (!email) return;
    setFailed(false);
    try {
      const result = await authClient.signIn.magicLink({
        email,
        callbackURL: `/${locale}/auth/callback`,
        metadata: { locale },
      });
      if (result.error) {
        setFailed(true);
        return;
      }
      setRequested(true);
    } catch {
      setFailed(true);
    }
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
            onClick={() => setRequested(false)}
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
        <form
          id="account-sign-in-form"
          action={requestLink}
          className="mt-8 space-y-5"
        >
          <div className="space-y-2">
            <Label htmlFor="account-sign-in-email">
              {m.accountSignInEmailLabel({}, { locale })}
            </Label>
            <Input
              id="account-sign-in-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder={m.accountSignInEmailPlaceholder({}, { locale })}
            />
          </div>
          <SignInSubmitButton locale={locale} />
        </form>
        <div aria-live="polite" className="mt-4 min-h-5 text-sm text-red-700">
          {failed ? m.accountSignInRequestFailed({}, { locale }) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function SignInSubmitButton({ locale }: SignInCardProps) {
  const { pending } = useFormStatus();

  return (
    <Button
      id="account-sign-in-submit"
      type="submit"
      disabled={pending}
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
