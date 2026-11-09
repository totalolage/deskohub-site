"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type AccountExit,
  beginAccountExit,
} from "@/features/account/account-exit";
import {
  type CustomerAccountDeletionResult,
  deleteCustomerAccount,
} from "@/features/account/actions";
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
  // The exit begun by the latest confirm click, settled by its outcome.
  const accountExit = useRef<AccountExit | undefined>(undefined);
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
      onSuccess: ({ data }) => {
        if (data?.status === "deleted") {
          accountExit.current?.left();
          allowNextUnload();
          leaveDocument(`/${locale}/account/deleted`);
          return;
        }
        accountExit.current?.stayed();
        if (data?.status === "reauthentication-required") {
          setReauthRequired(true);
          return;
        }
        // "failed" keeps the dialog open with the retryable error message;
        // "refused" keeps it open with a final one.
      },
      // Also runs for thrown (transport) failures, so no onTransportError.
      onError: () => {
        accountExit.current?.stayed();
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
      <DeleteAccountNotice deletionPending={deletionPending} locale={locale} />

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
            <DeleteAccountConfirmation
              confirmed={confirmed}
              deletionStatus={result.data?.status}
              hasErrored={hasErrored}
              isExecuting={isExecuting}
              locale={locale}
              onCancel={() => closeDialog(false)}
              onConfirm={() => {
                accountExit.current = beginAccountExit();
                execute({ confirmed: true });
              }}
              onConfirmedChange={setConfirmed}
              serverError={result.serverError}
            />
          )}
        </DialogContent>
      </Dialog>
    </AccountSectionPanel>
  );
}

function DeleteAccountNotice({
  deletionPending,
  locale,
}: {
  readonly deletionPending: boolean;
  readonly locale: Locale;
}) {
  return (
    <div className="rounded-xl border border-rose-100 bg-rose-50 p-4">
      <h3 className="text-sm font-semibold leading-5 text-rose-800">
        {deletionPending
          ? m.accountDeletionPendingTitle({}, { locale })
          : m.accountDeletionTitle({}, { locale })}
      </h3>
      <div className="mt-2 space-y-2 text-sm leading-5 text-rose-800">
        {deletionPending && (
          <p>{m.accountDeletionPendingDescription({}, { locale })}</p>
        )}
        <p>{m.accountDeletionDescription({}, { locale })}</p>
      </div>
    </div>
  );
}

type DeletionRequestOutcome = {
  /** The last attempt's answer; absent before one answers. */
  readonly deletionStatus: CustomerAccountDeletionResult["status"] | undefined;
  readonly serverError: string | undefined;
  /** Whether the last attempt failed, also in transport. */
  readonly hasErrored: boolean;
  readonly locale: Locale;
};

/** The dialog's confirmation step: tick the box, then delete. */
function DeleteAccountConfirmation({
  confirmed,
  isExecuting,
  onCancel,
  onConfirm,
  onConfirmedChange,
  ...outcome
}: DeletionRequestOutcome & {
  readonly confirmed: boolean;
  readonly isExecuting: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly onConfirmedChange: (confirmed: boolean) => void;
}) {
  const { locale } = outcome;
  return (
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
          onCheckedChange={(checked) => onConfirmedChange(checked === true)}
        />
        <Label
          htmlFor="confirm-account-deletion"
          className="cursor-pointer text-sm leading-6 text-navy-blue/78"
        >
          {m.accountDeletionConfirmLabel({}, { locale })}
        </Label>
      </div>

      <DeletionRequestFeedback {...outcome} />

      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          disabled={isExecuting}
          onClick={onCancel}
        >
          {m.accountDeletionCancel({}, { locale })}
        </Button>
        <Button
          id="delete-account-confirm"
          type="button"
          disabled={
            !confirmed || isExecuting || outcome.deletionStatus === "refused"
          }
          tone="danger"
          onClick={onConfirm}
        >
          {isExecuting
            ? m.accountDeletionConfirming({}, { locale })
            : m.accountDeletionConfirm({}, { locale })}
        </Button>
      </DialogFooter>
    </>
  );
}

/** Announces why the last deletion attempt didn't delete the account. */
function DeletionRequestFeedback({
  deletionStatus,
  serverError,
  hasErrored,
  locale,
}: DeletionRequestOutcome) {
  return (
    <div aria-live="assertive" className="mt-4 min-h-5 text-sm text-red-700">
      {deletionStatus === "failed"
        ? m.accountDeletionRetryableError({}, { locale })
        : null}
      {deletionStatus === "refused"
        ? m.accountDeletionRefused({}, { locale })
        : null}
      {serverError ?? null}
      {hasErrored &&
        serverError === undefined &&
        m.accountDeletionRequestFailed({}, { locale })}
    </div>
  );
}
