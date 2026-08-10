"use client";

import type { CliSessionIdType } from "@deskohub/workspace-admin-api";
import { useFormStatus } from "react-dom";
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
import { revokeCliSession } from "./actions";

export function RevokeCliSession({
  clientName,
  revoked,
  sessionId,
}: {
  readonly clientName: string;
  readonly revoked: boolean;
  readonly sessionId: CliSessionIdType;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button disabled={revoked} size="sm" type="button" variant="secondary">
          Revoke
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revoke CLI session?</DialogTitle>
          <DialogDescription>
            “{clientName}” will immediately lose Workspace administration
            access. Its CLI will remove the credential when it next contacts the
            API. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <form action={revokeCliSession}>
          <input name="sessionId" type="hidden" value={sessionId} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <RevokeAccessButton />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RevokeAccessButton() {
  const { pending } = useFormStatus();
  return (
    <Button disabled={pending} type="submit">
      {pending ? "Revoking…" : "Revoke access"}
    </Button>
  );
}
