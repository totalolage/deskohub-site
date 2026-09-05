"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";
import { authClient } from "@/features/account/auth.client";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import { useConfirmDiscardChanges } from "@/shared/components/unsaved-changes-guard";

type SignOutButtonProps = {
  readonly locale: Locale;
};

export function SignOutButton({ locale }: SignOutButtonProps) {
  const [signingOut, setSigningOut] = useState(false);
  const confirmDiscardChanges = useConfirmDiscardChanges();

  const signOut = async () => {
    const target = `/${locale}`;
    if (!confirmDiscardChanges(target)) return;

    setSigningOut(true);
    await authClient.signOut();
    window.location.assign(target);
  };

  return (
    <Button
      id="account-sign-out"
      type="button"
      disabled={signingOut}
      className="bg-red-800 hover:bg-red-900"
      onClick={signOut}
    >
      <LogOut aria-hidden className="size-4" />
      {m.accountSignOut({}, { locale })}
    </Button>
  );
}
