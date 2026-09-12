"use client";

import { LogOut } from "lucide-react";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { getAccountScreenCopy } from "./account-screen-copy";
import { AccountShell, type AccountShellProps } from "./shell/account-shell";

const disabledAccountSections = [
  "reservations",
  "profile",
  "billing",
  "legal",
  "danger",
] as const;

const noopSectionChange: AccountShellProps["onSectionChange"] = () => undefined;

function AccountSignOutLoading({ locale }: { readonly locale: Locale }) {
  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        id="account-sign-out"
        type="button"
        disabled
        className="max-w-full whitespace-normal bg-red-800 hover:bg-red-900"
      >
        <LogOut aria-hidden className="size-4" />
        {m.accountSignOut({}, { locale })}
      </Button>
    </div>
  );
}

export function AccountLoading({ locale }: { readonly locale: Locale }) {
  return (
    <AccountShell
      activeSection="reservations"
      disabledSections={disabledAccountSections}
      labels={getAccountScreenCopy(locale).shell}
      onSectionChange={noopSectionChange}
      signOut={<AccountSignOutLoading locale={locale} />}
      title={m.accountTitle({}, { locale })}
    >
      <AccountContentLoading locale={locale} />
    </AccountShell>
  );
}

export function AccountContentLoading({ locale }: { readonly locale: Locale }) {
  return (
    <div
      aria-label={m.accountMetadataTitle({}, { locale })}
      data-slot="account-content-loading"
      role="status"
    >
      <span className="sr-only">{m.accountContentLoading({}, { locale })}</span>
      <div aria-busy="true">
        <div aria-hidden="true" className="space-y-4">
          <Skeleton className="h-8 w-48 rounded-2xl" />
          <Skeleton className="h-4 w-full max-w-xl" />
          <Skeleton className="h-4 w-4/5 max-w-lg" />
          <Skeleton className="h-12 w-full max-w-md rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
