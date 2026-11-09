"use client";

import { useState } from "react";
import {
  type AccountPasskey,
  type PasskeyChangeResult,
  passkeyDisplayName,
} from "@/features/account/passkeys";
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

type PasskeyDeleteDialogProps = {
  readonly locale: Locale;
  /** The passkey being deleted; the dialog is closed while null. */
  readonly passkey: AccountPasskey | null;
  /** Whether it is the account's only passkey; email still signs in. */
  readonly last: boolean;
  readonly deletePasskey: (id: string) => Promise<PasskeyChangeResult>;
  readonly onDeleted: () => void;
  readonly onClose: () => void;
};

export function PasskeyDeleteDialog({
  locale,
  passkey,
  last,
  deletePasskey,
  onDeleted,
  onClose,
}: PasskeyDeleteDialogProps) {
  const [deleting, setDeleting] = useState(false);
  const [failed, setFailed] = useState(false);
  // Keep the name through the closing animation.
  const [shown, setShown] = useState(passkey);
  if (passkey !== null && passkey !== shown) setShown(passkey);

  const close = (nextOpen: boolean) => {
    if (nextOpen || deleting) return;
    setFailed(false);
    onClose();
  };

  const confirm = async () => {
    if (passkey === null) return;
    setFailed(false);
    setDeleting(true);
    const result = await deletePasskey(passkey.id);
    setDeleting(false);
    if (result === "saved") onDeleted();
    else setFailed(true);
  };

  return (
    <Dialog open={passkey !== null} onOpenChange={close}>
      <DialogContent
        aria-describedby="delete-passkey-dialog-description"
        locale={locale}
      >
        <DialogHeader>
          <DialogTitle>
            {m.accountPasskeyDeleteTitle(
              { name: shown ? passkeyDisplayName(shown, locale) : "" },
              { locale }
            )}
          </DialogTitle>
          <DialogDescription id="delete-passkey-dialog-description">
            {m.accountPasskeyDeleteBody({}, { locale })}
          </DialogDescription>
        </DialogHeader>
        {last && (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
            {m.accountPasskeyDeleteLastBody({}, { locale })}
          </p>
        )}
        <div
          aria-live="assertive"
          className="mt-4 min-h-5 text-sm text-red-700"
        >
          {failed && m.accountPasskeyDeleteFailed({}, { locale })}
        </div>
        <DialogFooter>
          <Button
            disabled={deleting}
            onClick={() => close(false)}
            type="button"
            variant="ghost"
          >
            {m.accountPasskeyDialogCancel({}, { locale })}
          </Button>
          <Button
            disabled={deleting}
            id="delete-passkey-confirm"
            onClick={confirm}
            tone="danger"
            type="button"
          >
            {deleting
              ? m.accountPasskeyDeleting({}, { locale })
              : m.accountPasskeyDeleteConfirm({}, { locale })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
