"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteCustomerAccount } from "@/features/account/actions";
import { authClient } from "@/features/account/auth.client";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
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
};

export function DeleteAccountCard({
  email,
  locale,
  deletionPending,
  heading,
}: DeleteAccountCardProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [reauthRequired, setReauthRequired] = useState(false);
  const [reauthLinkSent, setReauthLinkSent] = useState(false);
  const [reauthSending, setReauthSending] = useState(false);
  const [reauthFailed, setReauthFailed] = useState(false);
  const allowNextUnload = useAllowNextUnload();

  const { execute, isExecuting, result, reset } = useWorkspaceAction(
    deleteCustomerAccount,
    {
      actionName: "account.delete",
      onSuccess: ({ data }) => {
        if (data?.status === "deleted") {
          allowNextUnload();
          window.location.assign(`/${locale}/account/deleted`);
          return;
        }
        if (data?.status === "reauthentication-required") {
          setReauthRequired(true);
          return;
        }
        // "failed" keeps the dialog open with the retryable error message.
      },
    }
  );

  const requestReauthLink = async () => {
    setReauthFailed(false);
    setReauthSending(true);
    try {
      const linkResult = await authClient.signIn.magicLink({
        email,
        callbackURL: `/${locale}/auth/callback`,
        metadata: { locale },
      });
      if (linkResult.error) {
        setReauthFailed(true);
        return;
      }
      setReauthLinkSent(true);
    } catch {
      setReauthFailed(true);
    } finally {
      setReauthSending(false);
    }
  };

  const closeDialog = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setConfirmed(false);
      setReauthRequired(false);
      setReauthLinkSent(false);
      setReauthFailed(false);
      reset();
      router.refresh();
    }
  };

  const noticeTitle = deletionPending
    ? m.accountDeletionPendingTitle({}, { locale })
    : m.accountDeletionTitle({}, { locale });
  const cardHeading = heading ?? m.accountDeletionTitle({}, { locale });

  return (
    <Card className="rounded-2xl border-rose-200 bg-white p-5 shadow-none sm:p-8">
      <CardHeader className="space-y-0 border-b border-rose-200 p-0 pb-5">
        <CardTitle
          as="h2"
          className="flex items-center gap-2 font-semibold text-rose-900"
        >
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full bg-rose-500"
          />
          {cardHeading}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 pt-4">
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
          <DialogTrigger asChild>
            <Button
              id="delete-account-trigger"
              type="button"
              variant="primary"
              className="mt-6 flex h-auto min-h-11 w-full whitespace-normal rounded-xl bg-rose-600 px-5 py-3 text-center leading-5 text-white hover:bg-rose-700 sm:ml-auto sm:w-auto sm:whitespace-nowrap"
            >
              <Trash2 aria-hidden className="size-4" />
              {deletionPending
                ? m.accountDeletionConfirm({}, { locale })
                : m.accountDeletionButton({}, { locale })}
            </Button>
          </DialogTrigger>
          <DialogContent aria-describedby="delete-account-dialog-description">
            {reauthRequired ? (
              <>
                <DialogHeader>
                  <DialogTitle>
                    {m.accountDeletionReauthTitle({}, { locale })}
                  </DialogTitle>
                  <DialogDescription id="delete-account-dialog-description">
                    {m.accountDeletionReauthBody({}, { locale })}
                  </DialogDescription>
                </DialogHeader>
                <div
                  aria-live={reauthFailed ? "assertive" : "polite"}
                  className="mt-4 min-h-5 text-sm text-navy-blue/78"
                  role={reauthFailed ? "alert" : undefined}
                >
                  {reauthFailed && m.accountSignInRequestFailed({}, { locale })}
                  {!reauthFailed &&
                    reauthLinkSent &&
                    m.accountDeletionReauthLinkSent({}, { locale })}
                </div>
                <DialogFooter>
                  <Button
                    id="delete-account-reauth-send"
                    type="button"
                    disabled={reauthSending || reauthLinkSent}
                    onClick={requestReauthLink}
                  >
                    {m.accountDeletionReauthSendLink({}, { locale })}
                  </Button>
                </DialogFooter>
              </>
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
                    onCheckedChange={(checked) =>
                      setConfirmed(checked === true)
                    }
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
                  {result.serverError ?? null}
                </div>

                <DialogFooter>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => closeDialog(false)}
                  >
                    {m.accountDeletionCancel({}, { locale })}
                  </Button>
                  <Button
                    id="delete-account-confirm"
                    type="button"
                    disabled={!confirmed || isExecuting}
                    className="bg-red-800 hover:bg-red-900"
                    onClick={() => execute({ confirmed: true })}
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
      </CardContent>
    </Card>
  );
}
