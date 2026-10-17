"use client";

import { useState } from "react";
import { m } from "@/features/administration/i18n";
import { AdministrationAlert } from "@/features/administration/notice";
import { useRouteLocale } from "@/features/i18n/route-locale";
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
import { revokeAdministrator } from "./actions";
import type { AdministratorListItem } from "./page-data.server";

export function RevokeAdministrator({
  administrator,
  onRevoked,
}: {
  readonly administrator: AdministratorListItem;
  readonly onRevoked: (outcome: { readonly changed: boolean }) => void;
}) {
  const locale = useRouteLocale();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { execute, isExecuting } = useWorkspaceAction(revokeAdministrator, {
    actionName: "revokeAdministrator",
    onSuccess: ({ data }) => {
      if (!data) return;
      setOpen(false);
      onRevoked(data);
    },
    onError: ({ error }) => {
      setError(
        error.serverError ?? m.administratorsRevokeFailed({}, { locale })
      );
    },
    onTransportError: () => {
      setError(m.administratorsServerUnreachable({}, { locale }));
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isExecuting) return;
        setError(null);
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button
          aria-label={m.administratorsRevokeAccessibleLabel(
            { email: administrator.email },
            { locale }
          )}
          size="sm"
          type="button"
          variant="secondary"
        >
          {m.administratorsRevoke({}, { locale })}
        </Button>
      </DialogTrigger>
      <DialogContent locale={locale}>
        <DialogHeader>
          <DialogTitle>
            {m.administratorsRevokeTitle({}, { locale })}
          </DialogTitle>
          <DialogDescription>
            {m.administratorsRevokeDescription(
              { email: administrator.email },
              { locale }
            )}
          </DialogDescription>
        </DialogHeader>
        <div role="alert">
          {error ? (
            <AdministrationAlert status="error">{error}</AdministrationAlert>
          ) : null}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button disabled={isExecuting} type="button" variant="secondary">
              {m.administratorsRevokeCancel({}, { locale })}
            </Button>
          </DialogClose>
          <Button
            disabled={isExecuting}
            onClick={() => {
              setError(null);
              execute({ accountId: administrator.accountId });
            }}
            type="button"
          >
            {m.administratorsRevokeConfirm({}, { locale })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
