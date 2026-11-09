"use client";

import { Check, Fingerprint, Loader2 } from "lucide-react";
import { useState } from "react";
import type { PasskeyCreationResult } from "@/features/account/passkeys";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";

type PasskeyPromptDialogProps = {
  readonly locale: Locale;
  readonly open: boolean;
  readonly createPasskey: () => Promise<PasskeyCreationResult>;
  /** Runs once the passkey exists; the caller closes the prompt. */
  readonly onCreated: () => void;
  /**
   * "Not now", the close button, or Escape. The caller remembers it on this
   * device so the prompt never returns there.
   */
  readonly onDismiss: () => void;
};

/**
 * Offers a passkey on the account page right after an email sign-in, on a
 * browser that can create one and doesn't hold one for this account yet.
 */
export function PasskeyPromptDialog({
  locale,
  open,
  createPasskey,
  onCreated,
  onDismiss,
}: PasskeyPromptDialogProps) {
  const [creating, setCreating] = useState(false);
  const [failed, setFailed] = useState(false);

  const create = async () => {
    setFailed(false);
    setCreating(true);
    const result = await createPasskey();
    setCreating(false);
    if (result === "created") {
      onCreated();
      return;
    }
    // The session is fresh right after sign-in, so a re-auth demand is a
    // failure here too.
    setFailed(result !== "cancelled");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !creating) onDismiss();
      }}
    >
      <DialogContent
        aria-describedby="passkey-prompt-points"
        className="max-w-sm overflow-hidden p-0"
        locale={locale}
      >
        <div className="flex justify-center bg-[radial-gradient(circle_at_30%_20%,rgba(236,164,35,0.28),transparent_55%),radial-gradient(circle_at_80%_90%,rgba(0,223,153,0.18),transparent_50%)] bg-[#f4f3ef] px-6 pt-8 pb-6">
          <span className="flex size-16 items-center justify-center rounded-2xl bg-white text-burned-orange shadow-[0_18px_40px_-20px_rgba(0,2,79,0.5)]">
            <Fingerprint aria-hidden className="size-8" strokeWidth={1.75} />
          </span>
        </div>
        <div className="px-6 pt-5 pb-6">
          <DialogHeader>
            <DialogTitle className="pr-0 text-center text-2xl">
              {m.accountPasskeyPromptTitle({}, { locale })}
            </DialogTitle>
          </DialogHeader>
          <ul
            className="mt-5 space-y-2 text-sm leading-5 text-navy-blue/78"
            id="passkey-prompt-points"
          >
            {[
              m.accountPasskeyPromptPointStorage({}, { locale }),
              m.accountPasskeyPromptPointEmail({}, { locale }),
            ].map((point) => (
              <li className="flex gap-2.5" key={point}>
                <Check
                  aria-hidden
                  className="mt-0.5 size-4 shrink-0 text-aquamarine-ink"
                />
                {point}
              </li>
            ))}
          </ul>
          <div aria-live="polite" className="mt-4 min-h-5 text-sm text-red-700">
            {failed && m.accountPasskeyCreateFailed({}, { locale })}
          </div>
          <div className="mt-2 flex flex-col gap-2">
            <Button
              disabled={creating}
              fullWidth
              id="passkey-prompt-create"
              onClick={create}
              type="button"
            >
              {creating && (
                <Loader2 aria-hidden className="size-4 animate-spin" />
              )}
              {creating
                ? m.accountPasskeyCreating({}, { locale })
                : m.accountPasskeyCreate({}, { locale })}
            </Button>
            <Button
              disabled={creating}
              onClick={onDismiss}
              type="button"
              variant="ghost"
            >
              {m.accountPasskeyPromptDismiss({}, { locale })}
            </Button>
          </div>
          <p className="mt-3 text-center text-xs leading-5 text-navy-blue/55">
            {m.accountPasskeyPromptLater({}, { locale })}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
