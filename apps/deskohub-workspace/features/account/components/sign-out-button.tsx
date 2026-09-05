"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";
import { authClient } from "@/features/account/auth.client";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import {
  useCancelNavigationApproval,
  useConfirmDiscardChanges,
} from "@/shared/components/unsaved-changes-guard";

type SignOutButtonProps = {
  readonly locale: Locale;
};

export function SignOutButton({ locale }: SignOutButtonProps) {
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const cancelNavigationApproval = useCancelNavigationApproval();
  const confirmDiscardChanges = useConfirmDiscardChanges();

  const signOut = async () => {
    const target = `/${locale}`;
    if (!confirmDiscardChanges(target)) return;

    setSigningOut(true);
    setSignOutFailed(false);

    try {
      const result = await authClient.signOut();
      if (result.error) {
        cancelNavigationApproval();
        setSigningOut(false);
        setSignOutFailed(true);
        return;
      }
      window.location.assign(target);
    } catch {
      cancelNavigationApproval();
      setSigningOut(false);
      setSignOutFailed(true);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
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
      {signOutFailed && (
        <div role="alert" aria-live="polite" className="text-sm text-red-700">
          {m.accountSignOutFailed({}, { locale })}
        </div>
      )}
    </div>
  );
}
