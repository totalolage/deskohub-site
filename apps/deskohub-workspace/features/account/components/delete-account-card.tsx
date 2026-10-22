"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { deleteCustomerAccount } from "@/features/account/actions";
import {
  beginAnalyticsAccountTransition,
  completeAnalyticsAccountSignOut,
  refreshAnalyticsAccountIdentity,
} from "@/features/account/analytics-identity";
import { createAuthReturnLifecycle } from "@/features/account/auth-return";
import { AccountReauthenticationStep } from "@/features/account/components/account-reauthentication-step";
import type { AccountPasskeys } from "@/features/account/components/passkeys/use-account-passkeys";
import { AccountSectionPanel } from "@/features/account/components/shell/account-section-panel";
import { type Locale, m } from "@/features/i18n";
import { leaveDocument } from "@/shared/browser/document-navigation";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";
import { Label } from "@/shared/components/ui/label";
import { useAllowNextUnload } from "@/shared/components/unsaved-changes-guard";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";

type DeleteAccountCardProps = {
  readonly email: string;
  readonly locale: Locale;
  /** True when the durable deletion marker is set and deletion is retryable. */
  readonly deletionPending: boolean;
  readonly heading?: string;
  /**
   * The account's passkeys; absent while `login_passkeys` is off. A stale
   * session can confirm with one of them.
   */
  readonly passkeys?: Pick<AccountPasskeys, "confirmWithPasskey">;
};

export function DeleteAccountCard({
  passkeys,
  email,
  locale,
  deletionPending,
  heading,
}: DeleteAccountCardProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [reauthRequired, setReauthRequired] = useState(false);
  const allowNextUnload = useAllowNextUnload();
  const authReturn = useMemo(
    () =>
      createAuthReturnLifecycle({
        locale,
        requireFreshSession: true,
      }),
    [locale]
  );

  useEffect(() => authReturn.cancel, [authReturn]);

  const { execute, hasErrored, isExecuting, isIdle, result, reset } =
    useWorkspaceAction(deleteCustomerAccount, {
      actionName: "account.delete",
      onSuccess: ({ data }) => {
        if (data?.status === "deleted") {
          completeAnalyticsAccountSignOut();
          allowNextUnload();
          leaveDocument(`/${locale}/account/deleted`);
          return;
        }
        void refreshAnalyticsAccountIdentity({ settleTransition: true }).catch(
          () => undefined
        );
        if (data?.status === "reauthentication-required") {
          setReauthRequired(true);
          return;
        }
        // "failed" keeps the dialog open with the retryable error message;
        // "refused" keeps it open with a final one.
      },
      // Also runs for thrown (transport) failures, so no onTransportError.
      onError: () => {
        void refreshAnalyticsAccountIdentity({ settleTransition: true }).catch(
          () => undefined
        );
      },
    });

  const closeDialog = (nextOpen: boolean) => {
    // Closing mid-request would reset the action and drop its outcome.
    if (!nextOpen && isExecuting) return;
    setOpen(nextOpen);
    if (!nextOpen) {
      authReturn.cancel();
      setConfirmed(false);
      setReauthRequired(false);
      reset();
      // A deletion attempt may have changed the server-side deletion state.
      if (!isIdle) router.refresh();
    }
  };

  const noticeTitle = deletionPending
    ? m.accountDeletionPendingTitle({}, { locale })
    : m.accountDeletionTitle({}, { locale });
  const cardHeading = heading ?? m.accountDeletionTitle({}, { locale });

  return (
    <AccountSectionPanel
      className="min-w-0"
      title={
        <>
          <span
            aria-hidden
            className="mr-2 inline-block size-2 shrink-0 rounded-full bg-rose-500"
          />
          {cardHeading}
        </>
      }
      variant="destructive"
    >
      <div className="rounded-xl border border-rose-100 bg-rose-50 p-4">
        <h3 className="text-sm font-semibold leading-5 text-rose-800">
          {noticeTitle}
        </h3>
        <div className="mt-2 space-y-2 text-sm leading-5 text-rose-800">
          {deletionPending && (
            <p>{m.accountDeletionPendingDescription({}, { locale })}</p>
          )}
          <p>{m.accountDeletionDescription({}, { locale })}</p>
        </div>
      </div>

      <Dialog open={open} onOpenChange={closeDialog}>
        <div className="mt-6 flex @xl:justify-end">
          <DialogTrigger asChild>
            <Button
              className="@xl:w-auto"
              fullWidth
              id="delete-account-trigger"
              shape="rounded"
              tone="danger"
              type="button"
              wrap
            >
              <Trash2 aria-hidden className="size-4" />
              {deletionPending
                ? m.accountDeletionConfirm({}, { locale })
                : m.accountDeletionButton({}, { locale })}
            </Button>
          </DialogTrigger>
        </div>
        <DialogContent
          aria-describedby="delete-account-dialog-description"
          locale={locale}
        >
          {reauthRequired ? (
            <AccountReauthenticationStep
              purpose="delete-account"
              passkeysEnabled={passkeys !== undefined}
              confirmWithPasskey={passkeys?.confirmWithPasskey}
              email={email}
              locale={locale}
              authReturn={authReturn}
              onReauthenticated={() => {
                // The code or passkey created a fresh session; confirm again.
                setReauthRequired(false);
                reset();
              }}
            />
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>
                  {m.accountDeletionConfirmTitle({}, { locale })}
                </DialogTitle>
                <DialogDescription id="delete-account-dialog-description">
                  {m.accountDeletionConfirmDescription({}, { locale })}
                </DialogDescription>
              </DialogHeader>

              <div className="mt-5 flex items-start gap-3 rounded-2xl border border-red-900/12 bg-red-50/70 p-4">
                <Checkbox
                  id="confirm-account-deletion"
                  checked={confirmed}
                  onCheckedChange={(checked) => setConfirmed(checked === true)}
                />
                <Label
                  htmlFor="confirm-account-deletion"
                  className="cursor-pointer text-sm leading-6 text-navy-blue/78"
                >
                  {m.accountDeletionConfirmLabel({}, { locale })}
                </Label>
              </div>

              <div
                aria-live="assertive"
                className="mt-4 min-h-5 text-sm text-red-700"
              >
                {result.data?.status === "failed"
                  ? m.accountDeletionRetryableError({}, { locale })
                  : null}
                {result.data?.status === "refused"
                  ? m.accountDeletionRefused({}, { locale })
                  : null}
                {result.serverError ?? null}
                {hasErrored &&
                  result.serverError === undefined &&
                  m.accountDeletionRequestFailed({}, { locale })}
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={isExecuting}
                  onClick={() => closeDialog(false)}
                >
                  {m.accountDeletionCancel({}, { locale })}
                </Button>
                <Button
                  id="delete-account-confirm"
                  type="button"
                  disabled={
                    !confirmed ||
                    isExecuting ||
                    result.data?.status === "refused"
                  }
                  tone="danger"
                  onClick={() => {
                    beginAnalyticsAccountTransition();
                    execute({ confirmed: true });
                  }}
                >
                  {isExecuting
                    ? m.accountDeletionConfirming({}, { locale })
                    : m.accountDeletionConfirm({}, { locale })}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </AccountSectionPanel>
  );
}
