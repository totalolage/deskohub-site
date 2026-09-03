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
  CardDescription,
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
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";

type DeleteAccountCardProps = {
  readonly email: string;
  readonly locale: Locale;
  /** True when the durable deletion marker is set and deletion is retryable. */
  readonly deletionPending: boolean;
};

export function DeleteAccountCard({
  email,
  locale,
  deletionPending,
}: DeleteAccountCardProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [reauthRequired, setReauthRequired] = useState(false);
  const [reauthLinkSent, setReauthLinkSent] = useState(false);
  const [reauthSending, setReauthSending] = useState(false);

  const { execute, isExecuting, result, reset } = useWorkspaceAction(
    deleteCustomerAccount,
    {
      actionName: "account.delete",
      onSuccess: ({ data }) => {
        if (data?.status === "deleted") {
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
    setReauthSending(true);
    const linkResult = await authClient.signIn.magicLink({
      email,
      callbackURL: `/${locale}/auth/callback`,
      metadata: { locale },
    });
    setReauthSending(false);
    if (!linkResult.error) setReauthLinkSent(true);
  };

  const closeDialog = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setConfirmed(false);
      setReauthRequired(false);
      setReauthLinkSent(false);
      reset();
      router.refresh();
    }
  };

  const title = deletionPending
    ? m.accountDeletionPendingTitle({}, { locale })
    : m.accountDeletionTitle({}, { locale });
  const description = deletionPending
    ? m.accountDeletionPendingDescription({}, { locale })
    : m.accountDeletionDescription({}, { locale });

  return (
    <Card
      className={
        deletionPending
          ? "rounded-3xl border-red-800/30 bg-white/94 shadow-[0_26px_80px_-48px_rgba(0,2,79,0.55)]"
          : "rounded-3xl border-red-950/12 bg-white/92 shadow-none"
      }
    >
      <CardHeader>
        <CardTitle className="text-xl">{title}</CardTitle>
        <CardDescription className="max-w-3xl leading-6">
          {description}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Dialog open={open} onOpenChange={closeDialog}>
          <DialogTrigger asChild>
            <Button
              id="delete-account-trigger"
              type="button"
              variant="secondary"
              className="border-red-900/25 text-red-800 hover:border-red-900/55 hover:bg-red-50"
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
                  aria-live="polite"
                  className="mt-4 min-h-5 text-sm text-navy-blue/78"
                >
                  {reauthLinkSent
                    ? m.accountDeletionReauthLinkSent({}, { locale })
                    : null}
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
