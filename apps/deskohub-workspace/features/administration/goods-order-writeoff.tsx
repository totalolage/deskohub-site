"use client";

import type { AdministrationOrderIdType } from "@deskohub/workspace-admin-api";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/shared/components/ui/button";
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
import { writeOffOrder } from "./actions";
import { AdministrationAlert } from "./notice";

export function GoodsOrderWriteOff({
  orderId,
}: {
  readonly orderId: AdministrationOrderIdType;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { execute, isExecuting } = useWorkspaceAction(writeOffOrder, {
    actionName: "writeOffOrder",
    onSuccess: () => {
      setOpen(false);
      router.refresh();
    },
    onError: ({ error: actionError }) =>
      setError(
        actionError.serverError ?? "The order could not be written off."
      ),
    onTransportError: () =>
      setError("The response was interrupted. Refresh before trying again."),
  });

  return (
    <Dialog
      onOpenChange={(next) => {
        setError(null);
        setOpen(next);
      }}
      open={open}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="secondary">
          Write off order
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Write off this order?</DialogTitle>
          <DialogDescription>
            This records that the unpaid goods order is no longer being
            collected. It does not cancel the order or mark it as paid.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <AdministrationAlert role="alert" status="error">
            {error}
          </AdministrationAlert>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button disabled={isExecuting} type="button" variant="secondary">
              Keep collecting
            </Button>
          </DialogClose>
          <Button
            className="bg-burned-orange-ink hover:bg-burned-orange-ink/90"
            disabled={isExecuting}
            onClick={() => execute({ orderId })}
            type="button"
          >
            {isExecuting ? "Writing off…" : "Confirm write-off"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
