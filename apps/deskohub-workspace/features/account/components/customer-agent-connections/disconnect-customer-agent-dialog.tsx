"use client";

import { useState } from "react";
import type { CustomerAgentDisconnectResult } from "@/features/account/customer-agent-connections";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";

type DisconnectCustomerAgentDialogProps = {
  readonly locale: Locale;
  /** The assistant being disconnected; the dialog is closed while null. */
  readonly connection: { readonly id: string; readonly name: string } | null;
  readonly disconnect: (id: string) => Promise<CustomerAgentDisconnectResult>;
  readonly onDisconnected: () => void;
  readonly onClose: () => void;
};

export function DisconnectCustomerAgentDialog({
  locale,
  connection,
  disconnect,
  onDisconnected,
  onClose,
}: DisconnectCustomerAgentDialogProps) {
  const [disconnecting, setDisconnecting] = useState(false);
  const [failed, setFailed] = useState(false);
  // Keep the name through the closing animation.
  const [shown, setShown] = useState(connection);
  if (connection !== null && connection !== shown) setShown(connection);

  const close = (nextOpen: boolean) => {
    if (nextOpen || disconnecting) return;
    setFailed(false);
    onClose();
  };

  const confirm = async () => {
    if (connection === null) return;
    setFailed(false);
    setDisconnecting(true);
    const result = await disconnect(connection.id);
    setDisconnecting(false);
    if (result === "disconnected") onDisconnected();
    else setFailed(true);
  };

  return (
    <Dialog open={connection !== null} onOpenChange={close}>
      <DialogContent
        aria-describedby="disconnect-assistant-dialog-description"
        locale={locale}
      >
        <DialogHeader>
          <DialogTitle>
            {m.accountAssistantDisconnectTitle(
              { name: shown?.name ?? "" },
              { locale }
            )}
          </DialogTitle>
          <DialogDescription id="disconnect-assistant-dialog-description">
            {m.accountAssistantDisconnectBody({}, { locale })}
          </DialogDescription>
        </DialogHeader>
        <div
          aria-live="assertive"
          className="mt-4 min-h-5 text-sm text-red-700"
        >
          {failed && m.accountAssistantDisconnectFailed({}, { locale })}
        </div>
        <DialogFooter>
          <Button
            disabled={disconnecting}
            onClick={() => close(false)}
            type="button"
            variant="ghost"
          >
            {m.accountAssistantDialogCancel({}, { locale })}
          </Button>
          <Button
            disabled={disconnecting}
            id="disconnect-assistant-confirm"
            onClick={confirm}
            tone="danger"
            type="button"
          >
            {disconnecting
              ? m.accountAssistantDisconnecting({}, { locale })
              : m.accountAssistantDisconnectConfirm({}, { locale })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
