"use client";

import type { CliSessionIdType } from "@deskohub/workspace-admin-api";
import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
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
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import { renameCliSession } from "./actions";

export function RenameCliSession({
  clientName,
  sessionId,
}: {
  readonly clientName: string;
  readonly sessionId: CliSessionIdType;
}) {
  const inputId = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { execute, isExecuting } = useWorkspaceAction(renameCliSession, {
    actionName: "renameCliSession",
    onSuccess: ({ data }) => {
      if (!data) return;
      setOpen(false);
      router.refresh();
    },
    onError: ({ error: actionError }) =>
      setError(
        actionError.serverError ?? "The CLI session label could not be updated."
      ),
    onTransportError: () =>
      setError("The CLI session label could not be updated."),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" type="button" variant="secondary">
          <Pencil aria-hidden className="size-4" />
          Rename
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename CLI session</DialogTitle>
          <DialogDescription>
            Choose a label that makes this machine easy to recognize. Renaming
            does not change its access.
          </DialogDescription>
        </DialogHeader>
        <form
          className="mt-5"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            const nextClientName = new FormData(event.currentTarget)
              .get("clientName")
              ?.toString();
            if (!nextClientName) return;
            execute({ clientName: nextClientName, sessionId });
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor={inputId}>Client label</Label>
            <Input
              autoComplete="off"
              defaultValue={clientName}
              id={inputId}
              maxLength={80}
              name="clientName"
              required
            />
          </div>
          {error && (
            <p
              className="mt-3 rounded-xl bg-burned-orange/10 px-4 py-3 text-sm font-semibold text-burned-orange-ink"
              role="alert"
            >
              {error}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button disabled={isExecuting} type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button disabled={isExecuting} type="submit">
              {isExecuting ? "Saving…" : "Save label"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
