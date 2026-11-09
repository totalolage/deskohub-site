"use client";

import { useState } from "react";
import {
  confirmWithPasskey,
  createPasskey,
  deletePasskey,
  renamePasskey,
} from "@/features/account/passkey-client";
import { forgetPasskeyOnThisBrowser } from "@/features/account/passkey-prompt";
import type {
  AccountPasskey,
  AccountPasskeySettings,
  PasskeyChangeResult,
  PasskeyConfirmationResult,
  PasskeyCreationResult,
} from "@/features/account/passkeys";
import {
  capturePasskeyAdded,
  capturePasskeyRemoved,
  type PasskeyAddedSource,
} from "@/features/account/sign-in-analytics";

export type AccountPasskeys = {
  readonly accountId: string;
  /** Null when the list couldn't be read. */
  readonly passkeys: readonly AccountPasskey[] | null;
  readonly createPasskey: (
    source: PasskeyAddedSource
  ) => Promise<PasskeyCreationResult>;
  /** Re-authentication with one of the account's passkeys; absent without any. */
  readonly confirmWithPasskey:
    | (() => Promise<PasskeyConfirmationResult>)
    | undefined;
  readonly renamePasskey: (
    id: string,
    name: string
  ) => Promise<PasskeyChangeResult>;
  readonly deletePasskey: (id: string) => Promise<PasskeyChangeResult>;
};

/**
 * The account page's passkeys, shared by the post-sign-in prompt, the
 * Sign-in & security section, and account deletion. Changes update the list
 * in place, without reloading the account page.
 */
export function useAccountPasskeys(
  settings: AccountPasskeySettings | undefined
): AccountPasskeys | undefined {
  const [passkeys, setPasskeys] = useState(settings?.passkeys ?? null);
  if (settings === undefined) return undefined;
  const { accountId } = settings;

  return {
    accountId,
    passkeys,
    createPasskey: async (source) => {
      const creation = await createPasskey(accountId);
      if (creation.result !== "created") return creation.result;
      capturePasskeyAdded(source);
      const { passkey } = creation;
      if (passkey) {
        setPasskeys((current) => current && [...current, passkey]);
      }
      return creation.result;
    },
    confirmWithPasskey:
      passkeys !== null && passkeys.length > 0 ? confirmWithPasskey : undefined,
    renamePasskey: async (id, name) => {
      const result = await renamePasskey(id, name);
      if (result === "saved") {
        setPasskeys(
          (current) =>
            current?.map((passkey) =>
              passkey.id === id ? { ...passkey, name } : passkey
            ) ?? null
        );
      }
      return result;
    },
    deletePasskey: async (id) => {
      const result = await deletePasskey(id);
      if (result !== "saved") return result;
      capturePasskeyRemoved();
      const remaining =
        passkeys?.filter((passkey) => passkey.id !== id) ?? null;
      if (remaining?.length === 0) forgetPasskeyOnThisBrowser(accountId);
      setPasskeys(remaining);
      return result;
    },
  };
}
