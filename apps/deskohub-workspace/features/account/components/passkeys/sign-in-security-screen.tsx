"use client";

import { KeyRound, Loader2, Mail, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createAuthReturnLifecycle } from "@/features/account/auth-return";
import { AccountReauthenticationStep } from "@/features/account/components/account-reauthentication-step";
import { AccountSectionPanel } from "@/features/account/components/shell/account-section-panel";
import {
  type AccountPasskey,
  type PasskeyChangeResult,
  type PasskeyConfirmationResult,
  type PasskeyCreationResult,
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
import { maskEmailAddress, workspaceSiteConstants } from "@/shared/utils";
import { formatInstantDate } from "@/shared/utils/date-time-format";
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
type AddDialogStep = "closed" | "reauthenticate" | "ready";

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
  const [addDialogStep, setAddDialogStep] = useState<AddDialogStep>("closed");
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

  const createButton = (
    <>
      {creating ? (
        <Loader2 aria-hidden className="size-4 animate-spin" />
      ) : (
        <Plus aria-hidden className="size-4" />
      )}
      {creating
        ? m.accountPasskeyCreating({}, { locale })
        : m.accountSecurityPasskeysAdd({}, { locale })}
    </>
  );

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
              {createButton}
            </Button>
          )}
        </div>

        {passkeys === null && (
          <p
            className="mt-5 rounded-xl border border-[#dfe4ec] px-4 py-5 text-sm leading-6 text-navy-blue/68"
            id="account-security-passkeys-unavailable"
          >
            {m.accountSecurityPasskeysUnavailable({}, { locale })}
          </p>
        )}
        {passkeys !== null && passkeys.length > 0 && (
          <ul
            aria-labelledby="account-security-passkeys-title"
            className="mt-5 divide-y divide-[#e6ebf1] rounded-xl border border-[#dfe4ec]"
          >
            {passkeys.map((passkey) => {
              const name = passkeyDisplayName(passkey, locale);
              const date = formatInstantDate({
                instant: Temporal.Instant.from(passkey.createdAt),
                locale,
                timeZone: workspaceSiteConstants.location.timeZone,
              });
              return (
                <li
                  className="flex min-w-0 items-center gap-2 py-3 pr-2 pl-4 @xl:gap-4 @xl:p-4"
                  data-passkey-id={passkey.id}
                  key={passkey.id}
                >
                  <span className="hidden size-10 shrink-0 items-center justify-center rounded-xl bg-[#f4f3ef] text-navy-blue @xl:flex">
                    <KeyRound aria-hidden className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-navy-blue">
                      {name}
                    </p>
                    <p className="mt-0.5 text-sm text-navy-blue/60">
                      {passkey.provider === undefined ||
                      passkey.provider === name
                        ? m.accountSecurityPasskeyCreatedOn(
                            { date },
                            { locale }
                          )
                        : m.accountSecurityPasskeyDetails(
                            { provider: passkey.provider, date },
                            { locale }
                          )}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center @xl:gap-1">
                    <Button
                      aria-label={m.accountSecurityPasskeyRenameLabel(
                        { name },
                        { locale }
                      )}
                      onClick={() => setRenaming(passkey)}
                      shape="rounded"
                      size="sm"
                      tone="navy-blue"
                      type="button"
                      variant="ghost"
                    >
                      <Pencil aria-hidden className="size-4" />
                      <span className="hidden @xl:inline">
                        {m.accountSecurityPasskeyRename({}, { locale })}
                      </span>
                    </Button>
                    <Button
                      aria-label={m.accountSecurityPasskeyDeleteLabel(
                        { name },
                        { locale }
                      )}
                      onClick={() => setDeleting(passkey)}
                      shape="rounded"
                      size="sm"
                      tone="danger"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 aria-hidden className="size-4" />
                      <span className="hidden @xl:inline">
                        {m.accountSecurityPasskeyDelete({}, { locale })}
                      </span>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {passkeys?.length === 0 && (
          <div className="mt-5 flex flex-col items-center rounded-xl border border-dashed border-[#cfd6e0] bg-[#fbfcfd] px-6 py-8 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-white text-burned-orange shadow-[0_12px_28px_-18px_rgba(0,2,79,0.45)]">
              <KeyRound aria-hidden className="size-6" />
            </span>
            <p className="mt-4 font-semibold text-navy-blue">
              {m.accountSecurityPasskeysEmptyTitle({}, { locale })}
            </p>
            <Button
              className="mt-5"
              disabled={creating}
              id="account-security-add-passkey"
              onClick={addPasskey}
              type="button"
            >
              {creating ? (
                <Loader2 aria-hidden className="size-4 animate-spin" />
              ) : (
                <KeyRound aria-hidden className="size-4" />
              )}
              {creating
                ? m.accountPasskeyCreating({}, { locale })
                : m.accountPasskeyCreate({}, { locale })}
            </Button>
          </div>
        )}

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

      <Dialog open={addDialogStep !== "closed"} onOpenChange={closeAddDialog}>
        <DialogContent
          aria-describedby="add-passkey-dialog-description"
          locale={locale}
        >
          {addDialogStep === "reauthenticate" ? (
            <AccountReauthenticationStep
              purpose="add-passkey"
              authReturn={authReturn}
              confirmWithPasskey={confirmWithPasskey}
              email={email}
              locale={locale}
              onReauthenticated={() => setAddDialogStep("ready")}
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
                {addDialogFailed &&
                  m.accountPasskeyCreateFailed({}, { locale })}
              </div>
              <DialogFooter>
                <Button
                  disabled={creating}
                  onClick={() => closeAddDialog(false)}
                  type="button"
                  variant="ghost"
                >
                  {m.accountPasskeyDialogCancel({}, { locale })}
                </Button>
                <Button
                  disabled={creating}
                  id="add-passkey-create"
                  onClick={addPasskey}
                  type="button"
                >
                  {creating ? (
                    <Loader2 aria-hidden className="size-4 animate-spin" />
                  ) : (
                    <KeyRound aria-hidden className="size-4" />
                  )}
                  {creating
                    ? m.accountPasskeyCreating({}, { locale })
                    : m.accountPasskeyCreate({}, { locale })}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

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
