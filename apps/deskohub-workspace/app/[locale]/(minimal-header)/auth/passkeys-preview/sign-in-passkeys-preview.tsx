"use client";

// TEMPORARY passkey prototype harness (#635). Delete with its route.

import { SignInCard } from "@/features/account/components/sign-in-card";
import type { PasskeySignInResult } from "@/features/account/passkeys";
import type { Locale } from "@/features/i18n";

export function SignInPasskeysPreview({
  locale,
  outcome,
}: {
  readonly locale: Locale;
  readonly outcome: "pending" | "fails";
}) {
  return (
    <SignInCard
      locale={locale}
      signInWithPasskey={() =>
        new Promise<PasskeySignInResult>((resolve) => {
          if (outcome === "fails") setTimeout(() => resolve("failed"), 500);
        })
      }
    />
  );
}
