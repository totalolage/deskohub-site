"use client";

import { KeyRound, Loader2, Plus } from "lucide-react";
import type { AuthReturnLifecycle } from "@/features/account/auth-return";
import { AccountReauthenticationStep } from "@/features/account/components/account-reauthentication-step";
import type { PasskeyConfirmationResult } from "@/features/account/passkeys";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";

export type AddPasskeyDialogStep = "closed" | "reauthenticate" | "ready";

/**
 * A button's icon and label for starting a passkey: "add" beside the list,
 * "create" when the account has none or the dialog is ready.
 */
export function AddPasskeyButtonLabel({
  creating,
  locale,
  variant,
}: {
  readonly creating: boolean;
  readonly locale: Locale;
  readonly variant: "add" | "create";
}) {
  if (creating) {
    return (
      <>
        <Loader2 aria-hidden className="size-4 animate-spin" />
        {m.accountPasskeyCreating({}, { locale })}
      </>
    );
  }
  const { Icon, label } = {
    add: { Icon: Plus, label: m.accountSecurityPasskeysAdd },
    create: { Icon: KeyRound, label: m.accountPasskeyCreate },
  }[variant];
  return (
    <>
      <Icon aria-hidden className="size-4" />
      {label({}, { locale })}
    </>
  );
}

type AddPasskeyDialogProps = {
  readonly locale: Locale;
  readonly email: string;
  readonly step: AddPasskeyDialogStep;
  /** Whether the last attempt from the ready step failed. */
  readonly failed: boolean;
  readonly creating: boolean;
  readonly authReturn: AuthReturnLifecycle;
  readonly confirmWithPasskey?: () => Promise<PasskeyConfirmationResult>;
  readonly onReauthenticated: () => void;
  readonly onCreate: () => void;
  readonly onOpenChange: (nextOpen: boolean) => void;
};

/**
 * Adding a passkey once the session needs confirming: re-authenticate first,
 * then start the passkey with a fresh click.
 */
export function AddPasskeyDialog({
  locale,
  email,
  step,
  failed,
  creating,
  authReturn,
  confirmWithPasskey,
  onReauthenticated,
  onCreate,
  onOpenChange,
}: AddPasskeyDialogProps) {
  return (
    <Dialog open={step !== "closed"} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby="add-passkey-dialog-description"
        locale={locale}
      >
        {step === "reauthenticate" ? (
          <AccountReauthenticationStep
            purpose="add-passkey"
            authReturn={authReturn}
            confirmWithPasskey={confirmWithPasskey}
            email={email}
            locale={locale}
            onReauthenticated={onReauthenticated}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                {m.accountPasskeyReadyTitle({}, { locale })}
              </DialogTitle>
              <DialogDescription id="add-passkey-dialog-description">
                {m.accountPasskeyReadyBody({}, { locale })}
              </DialogDescription>
            </DialogHeader>
            <div
              aria-live="polite"
              className="mt-4 min-h-5 text-sm text-red-700"
            >
              {failed && m.accountPasskeyCreateFailed({}, { locale })}
            </div>
            <DialogFooter>
              <Button
                disabled={creating}
                onClick={() => onOpenChange(false)}
                type="button"
                variant="ghost"
              >
                {m.accountPasskeyDialogCancel({}, { locale })}
              </Button>
              <Button
                disabled={creating}
                id="add-passkey-create"
                onClick={onCreate}
                type="button"
              >
                <AddPasskeyButtonLabel
                  creating={creating}
                  locale={locale}
                  variant="create"
                />
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
