"use client";

import type { AdministrationWorkspaceReservationIdType } from "@deskohub/workspace-admin-api";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/shared/components/ui/button";
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
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import { cancelAdministrationReservation } from "./actions";
import { AdministrationAlert } from "./notice";

export function ReservationCancellation({
  canCancel,
  accessGrantUpdatedAt,
  requiresProviderCredentialRemoval,
  reservationId,
}: {
  readonly canCancel: boolean;
  readonly accessGrantUpdatedAt: string | null;
  readonly requiresProviderCredentialRemoval: boolean;
  readonly reservationId: AdministrationWorkspaceReservationIdType;
}) {
  const accessCheckboxId = useId();
  const checkboxId = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [providerCredentialRemoved, setProviderCredentialRemoved] =
    useState(false);
  const [sendCancellationEmail, setSendCancellationEmail] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { execute, isExecuting } = useWorkspaceAction(
    cancelAdministrationReservation,
    {
      actionName: "cancelAdministrationReservation",
      onSuccess: ({ data }) => {
        if (!data) return;
        setOpen(false);
        setMessage(
          {
            failed:
              "Reservation cancelled, but the cancellation email could not be sent.",
            not_requested:
              "Reservation cancelled without emailing the customer.",
            sent: "Reservation cancelled and the customer was emailed.",
          }[data.email]
        );
        router.refresh();
      },
      onError: ({ error: actionError }) =>
        setError(
          actionError.serverError ?? "The reservation could not be cancelled."
        ),
      onTransportError: () =>
        setError(
          "The cancellation response was interrupted. Refresh before trying again."
        ),
    }
  );

  if (!canCancel && !message) return null;

  return (
    <div className="space-y-2">
      {canCancel && (
        <Dialog
          onOpenChange={(nextOpen) => {
            setError(null);
            setOpen(nextOpen);
          }}
          open={open}
        >
          <DialogTrigger asChild>
            <Button type="button" variant="secondary">
              Cancel reservation
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Cancel this reservation?</DialogTitle>
              <DialogDescription>
                This cancels the booking in Dotypos and cannot be undone. Any
                paid online payment will be marked as needing a refund; no
                refund is issued automatically.
              </DialogDescription>
            </DialogHeader>
            {requiresProviderCredentialRemoval && (
              <label
                className="flex cursor-pointer items-start gap-3 rounded-xl border border-burned-orange/25 bg-burned-orange/5 p-4"
                htmlFor={accessCheckboxId}
              >
                <Checkbox
                  checked={providerCredentialRemoved}
                  id={accessCheckboxId}
                  onCheckedChange={(checked) =>
                    setProviderCredentialRemoved(Boolean(checked))
                  }
                />
                <span className="text-sm leading-6 text-navy-blue/70">
                  I removed the active door PIN from the lock in Igloohome
                </span>
              </label>
            )}
            <label
              className="flex cursor-pointer items-start gap-3 rounded-xl border border-navy-blue/10 bg-navy-blue/2.5 p-4"
              htmlFor={checkboxId}
            >
              <Checkbox
                checked={sendCancellationEmail}
                id={checkboxId}
                onCheckedChange={(checked) =>
                  setSendCancellationEmail(Boolean(checked))
                }
              />
              <span className="text-sm leading-6 text-navy-blue/70">
                Send a cancellation email to the customer
              </span>
            </label>
            {error && (
              <AdministrationAlert role="alert" status="error">
                {error}
              </AdministrationAlert>
            )}
            <DialogFooter>
              <DialogClose asChild>
                <Button
                  disabled={isExecuting}
                  type="button"
                  variant="secondary"
                >
                  Keep reservation
                </Button>
              </DialogClose>
              <Button
                className="bg-burned-orange-ink hover:bg-burned-orange-ink/90"
                disabled={
                  isExecuting ||
                  (requiresProviderCredentialRemoval &&
                    !providerCredentialRemoved)
                }
                onClick={() => {
                  setError(null);
                  execute({
                    accessGrantUpdatedAt,
                    providerCredentialRemoved,
                    reservationId,
                    sendCancellationEmail,
                  });
                }}
                type="button"
              >
                {isExecuting ? "Cancelling…" : "Cancel reservation"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {message && (
        <AdministrationAlert role="status" status="success">
          {message}
        </AdministrationAlert>
      )}
    </div>
  );
}
