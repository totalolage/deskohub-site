"use client";

import { Trash2 } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
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
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";
import { Label } from "@/shared/components/ui/label";
import { deleteCustomerAccount } from "../actions";

export function DeleteAccountCard({ locale }: { readonly locale: Locale }) {
  const [confirmed, setConfirmed] = useState(false);
  const [open, setOpen] = useState(false);
  const action = useAction(deleteCustomerAccount, {
    onSuccess: () => window.location.assign(`/${locale}`),
  });

  return (
    <Card className="rounded-3xl border-red-950/12 bg-white/92 shadow-none">
      <CardHeader>
        <CardTitle className="text-xl">
          {m.accountDangerTitle({}, { locale })}
        </CardTitle>
        <CardDescription className="max-w-3xl leading-6">
          {m.accountDangerDescription({}, { locale })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Dialog
          open={open}
          onOpenChange={(nextOpen) => {
            setOpen(nextOpen);
            if (!nextOpen) {
              setConfirmed(false);
              action.reset();
            }
          }}
        >
          <DialogTrigger asChild>
            <Button
              id="delete-account-trigger"
              type="button"
              variant="secondary"
              className="border-red-900/25 text-red-800 hover:border-red-900/55 hover:bg-red-50"
            >
              <Trash2 aria-hidden className="size-4" />
              {m.accountDeleteButton({}, { locale })}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {m.accountDeleteConfirmTitle({}, { locale })}
              </DialogTitle>
              <DialogDescription>
                {m.accountDeleteConfirmDescription({}, { locale })}
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
                {m.accountDeleteConfirmLabel({}, { locale })}
              </Label>
            </div>

            <div
              aria-live="polite"
              className="mt-4 min-h-5 text-sm text-red-700"
            >
              {action.result.serverError ??
                (action.hasErrored
                  ? m.accountDeleteError({}, { locale })
                  : null)}
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="ghost">
                  {m.accountDeleteCancel({}, { locale })}
                </Button>
              </DialogClose>
              <Button
                id="delete-account-confirm"
                type="button"
                disabled={!confirmed || action.isPending}
                className="bg-red-800 hover:bg-red-900"
                onClick={() => action.execute({ confirmed: true })}
              >
                {action.isPending
                  ? m.accountDeleting({}, { locale })
                  : m.accountDeleteConfirm({}, { locale })}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
