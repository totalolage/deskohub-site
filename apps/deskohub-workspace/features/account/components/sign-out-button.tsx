"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";
import { authClient } from "@/features/account/auth.client";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";

type SignOutButtonProps = {
  readonly locale: Locale;
};

export function SignOutButton({ locale }: SignOutButtonProps) {
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    setSigningOut(true);
    await authClient.signOut();
    window.location.assign(`/${locale}`);
  };

  return (
    <Button
      id="account-sign-out"
      type="button"
      variant="secondary"
      disabled={signingOut}
      onClick={signOut}
    >
      <LogOut aria-hidden className="size-4" />
      {m.accountSignOut({}, { locale })}
    </Button>
  );
}
