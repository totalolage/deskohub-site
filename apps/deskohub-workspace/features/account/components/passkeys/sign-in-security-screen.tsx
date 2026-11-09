"use client";

import { Mail } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createAuthReturnLifecycle } from "@/features/account/auth-return";
import { AccountSectionPanel } from "@/features/account/components/shell/account-section-panel";
import type {
  AccountPasskey,
  PasskeyChangeResult,
  PasskeyConfirmationResult,
  PasskeyCreationResult,
} from "@/features/account/passkeys";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import { maskEmailAddress } from "@/shared/utils";
import { AccountPasskeyList } from "./account-passkey-list";
import {
  AddPasskeyButtonLabel,
  AddPasskeyDialog,
  type AddPasskeyDialogStep,
} from "./add-passkey-dialog";
import { PasskeyDeleteDialog } from "./passkey-delete-dialog";
import { PasskeyRenameDialog } from "./passkey-rename-dialog";

type SignInSecurityScreenProps = {
  readonly locale: Locale;
  readonly email: string;
  /** Null when the list couldn't be read. */
  readonly passkeys: readonly AccountPasskey[] | null;
  readonly createPasskey: () => Promise<PasskeyCreationResult>;
  /** Re-authenticates with an existing passkey; absent without passkeys. */
  readonly confirmWithPasskey?: () => Promise<PasskeyConfirmationResult>;
  readonly renamePasskey: (
    id: string,
    name: string
  ) => Promise<PasskeyChangeResult>;
  readonly deletePasskey: (id: string) => Promise<PasskeyChangeResult>;
};

type Announcement = "created" | "create-failed" | "renamed" | "deleted";

/**
 * The account's sign-in methods: email, which always works, and the passkeys
 * the customer can add, rename and delete.
 */
export function SignInSecurityScreen({
  locale,
  email,
  passkeys,
  createPasskey,
  confirmWithPasskey,
  renamePasskey,
  deletePasskey,
}: SignInSecurityScreenProps) {
  const [creating, setCreating] = useState(false);
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [addDialogStep, setAddDialogStep] =
    useState<AddPasskeyDialogStep>("closed");
  const [addDialogFailed, setAddDialogFailed] = useState(false);
  const [renaming, setRenaming] = useState<AccountPasskey | null>(null);
  const [deleting, setDeleting] = useState<AccountPasskey | null>(null);
  // Re-authenticates a stale session by email before adding a passkey.
  const authReturn = useMemo(
    () => createAuthReturnLifecycle({ locale, requireFreshSession: true }),
    [locale]
  );

  useEffect(() => authReturn.cancel, [authReturn]);

  // WebAuthn needs a fresh user gesture, so each click starts its own
  // ceremony; after re-authentication the customer clicks once more.
  const addPasskey = async () => {
    setAnnouncement(null);
    setAddDialogFailed(false);
    setCreating(true);
    const result = await createPasskey();
    setCreating(false);
    if (result === "reauthentication-required") {
      setAddDialogStep("reauthenticate");
      return;
    }
    if (result === "created") {
      setAddDialogStep("closed");
      setAnnouncement("created");
      return;
    }
    if (result === "failed") {
      if (addDialogStep === "ready") setAddDialogFailed(true);
      else setAnnouncement("create-failed");
    }
  };

  const closeAddDialog = (nextOpen: boolean) => {
    if (nextOpen || creating) return;
    authReturn.cancel();
    setAddDialogStep("closed");
    setAddDialogFailed(false);
  };

  return (
    <AccountSectionPanel
      title={m.accountSectionSecurity({}, { locale })}
      bodyClassName="space-y-6"
    >
      <section aria-labelledby="account-security-passkeys-title">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
          <h3
            className="min-w-0 text-lg font-bold text-navy-blue"
            id="account-security-passkeys-title"
          >
            {m.accountSecurityPasskeysTitle({}, { locale })}
          </h3>
          {passkeys !== null && passkeys.length > 0 && (
            <Button
              className="@xl:w-auto"
              disabled={creating}
              fullWidth
              id="account-security-add-passkey"
              onClick={addPasskey}
              shape="rounded"
              size="md"
              type="button"
              variant="secondary"
            >
              <AddPasskeyButtonLabel
                creating={creating}
                locale={locale}
                variant="add"
              />
            </Button>
          )}
        </div>

        <AccountPasskeyList
          creating={creating}
          locale={locale}
          onCreate={addPasskey}
          onDelete={setDeleting}
          onRename={setRenaming}
          passkeys={passkeys}
        />

        <div
          aria-live="polite"
          className="mt-3 text-sm text-navy-blue/78 empty:mt-0"
          id="account-security-status"
        >
          {announcement &&
            {
              created: m.accountPasskeyCreated({}, { locale }),
              "create-failed": (
                <span className="text-red-700">
                  {m.accountPasskeyCreateFailed({}, { locale })}
                </span>
              ),
              renamed: m.accountPasskeyRenamed({}, { locale }),
              deleted: m.accountPasskeyDeleted({}, { locale }),
            }[announcement]}
        </div>
      </section>

      <section
        aria-labelledby="account-security-email-title"
        className="flex min-w-0 items-start gap-3 rounded-xl bg-[#f7f8fa] p-4 @xl:gap-4"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-navy-blue">
          <Mail aria-hidden className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          {/* The title wraps before the badge does; the badge drops below
              only when even the title's longest word can't sit beside it. */}
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3
              className="min-w-min max-w-max grow basis-0 font-semibold text-navy-blue"
              id="account-security-email-title"
            >
              {m.accountSecurityEmailTitle({}, { locale })}
            </h3>
            <span className="shrink-0 whitespace-nowrap rounded-full bg-aquamarine-ink/10 px-2.5 py-0.5 text-xs font-semibold text-aquamarine-ink">
              {m.accountSecurityEmailBadge({}, { locale })}
            </span>
          </div>
          <p className="mt-1 break-words text-sm leading-6 text-navy-blue/68">
            {m.accountSecurityEmailBody(
              { email: maskEmailAddress(email) },
              { locale }
            )}
          </p>
        </div>
      </section>

      <AddPasskeyDialog
        authReturn={authReturn}
        confirmWithPasskey={confirmWithPasskey}
        creating={creating}
        email={email}
        failed={addDialogFailed}
        locale={locale}
        onCreate={addPasskey}
        onOpenChange={closeAddDialog}
        onReauthenticated={() => setAddDialogStep("ready")}
        step={addDialogStep}
      />

      <PasskeyRenameDialog
        locale={locale}
        passkey={renaming}
        onClose={() => setRenaming(null)}
        onRenamed={() => {
          setRenaming(null);
          setAnnouncement("renamed");
        }}
        renamePasskey={renamePasskey}
      />
      <PasskeyDeleteDialog
        last={passkeys?.length === 1}
        locale={locale}
        passkey={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          setDeleting(null);
          setAnnouncement("deleted");
        }}
        deletePasskey={deletePasskey}
      />
    </AccountSectionPanel>
  );
}
