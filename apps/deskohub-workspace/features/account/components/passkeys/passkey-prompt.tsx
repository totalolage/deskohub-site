"use client";

import { useEffect, useState } from "react";
import {
  dismissPasskeyPrompt,
  shouldOfferPasskeyPrompt,
} from "@/features/account/passkey-prompt";
import type { PasskeyCreationResult } from "@/features/account/passkeys";
import { capturePasskeyPromptDismissed } from "@/features/account/sign-in-analytics";
import type { Locale } from "@/features/i18n";
import { PasskeyPromptDialog } from "./passkey-prompt-dialog";

type PasskeyPromptProps = {
  readonly locale: Locale;
  readonly accountId: string;
  /** Unknown when the account's passkey list couldn't be read. */
  readonly accountHasPasskeys: boolean | undefined;
  readonly createPasskey: () => Promise<PasskeyCreationResult>;
};

/**
 * Offers a passkey once on the account page after an email sign-in in this
 * tab; see `shouldOfferPasskeyPrompt` for when.
 */
export function PasskeyPrompt({
  locale,
  accountId,
  accountHasPasskeys,
  createPasskey,
}: PasskeyPromptProps) {
  const [open, setOpen] = useState(false);

  // The decision consumes this tab's sign-in note, so a repeated effect run
  // finds nothing and leaves the first run's answer in place.
  useEffect(() => {
    void shouldOfferPasskeyPrompt({ accountId, accountHasPasskeys }).then(
      (offer) => {
        if (offer) setOpen(true);
      }
    );
  }, [accountId, accountHasPasskeys]);

  return (
    <PasskeyPromptDialog
      createPasskey={createPasskey}
      locale={locale}
      onCreated={() => setOpen(false)}
      onDismiss={() => {
        dismissPasskeyPrompt(accountId);
        capturePasskeyPromptDismissed();
        setOpen(false);
      }}
      open={open}
    />
  );
}
