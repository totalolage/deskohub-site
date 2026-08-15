"use client";

import { Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import type { FormEvent } from "react";
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
import { updateCustomerProfile } from "../actions";

export function ProfileCard({
  email,
  locale,
  name,
}: {
  readonly email: string;
  readonly locale: Locale;
  readonly name: string;
}) {
  const router = useRouter();
  const action = useAction(updateCustomerProfile, {
    onSuccess: () => router.refresh(),
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    action.execute({ name: String(formData.get("name") ?? "") });
  };

  const validationMessage =
    action.result.validationErrors?.fieldErrors?.name?.[0];
  const errorMessage = action.result.serverError ?? validationMessage;

  return (
    <Card className="rounded-3xl border-white/70 bg-white/92 shadow-[0_26px_80px_-48px_rgba(0,2,79,0.55)]">
      <CardHeader>
        <CardTitle className="text-2xl">
          {m.accountProfileTitle({}, { locale })}
        </CardTitle>
        <CardDescription className="leading-6">
          {m.accountProfileDescription({}, { locale })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form id="account-profile-form" onSubmit={submit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="account-name">
              {m.accountProfileNameLabel({}, { locale })}
            </Label>
            <Input
              id="account-name"
              name="name"
              defaultValue={name}
              placeholder={m.accountProfileNamePlaceholder({}, { locale })}
              autoComplete="name"
              maxLength={100}
              required
              aria-invalid={Boolean(validationMessage)}
              aria-describedby={
                validationMessage ? "account-name-error" : undefined
              }
            />
            {validationMessage ? (
              <p id="account-name-error" className="text-sm text-red-700">
                {m.accountProfileNameRequired({}, { locale })}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="account-email">
              {m.accountProfileEmailLabel({}, { locale })}
            </Label>
            <Input
              id="account-email"
              value={email}
              type="email"
              autoComplete="email"
              readOnly
              className="bg-navy-blue/3 text-navy-blue/70"
            />
            <p className="text-xs leading-5 text-navy-blue/58">
              {m.accountProfileEmailReadonly({}, { locale })}
            </p>
          </div>

          <div aria-live="polite" className="min-h-5 text-sm">
            {action.hasSucceeded ? (
              <p className="text-emerald-800">
                {m.accountProfileSaved({}, { locale })}
              </p>
            ) : null}
            {errorMessage && !validationMessage ? (
              <p className="text-red-700">{errorMessage}</p>
            ) : null}
          </div>

          <Button
            id="account-profile-save"
            type="submit"
            disabled={action.isPending}
          >
            <Save aria-hidden className="size-4" />
            {action.isPending
              ? m.accountProfileSaving({}, { locale })
              : m.accountProfileSave({}, { locale })}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
