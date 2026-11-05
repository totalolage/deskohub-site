import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import type { CustomerAgentDisconnectResult } from "@/features/account/customer-agent-connections";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();
// @testing-library/react must load after the happy-dom registration.
const { act, cleanup, fireEvent, render } = await import(
  "@testing-library/react"
);
const { DisconnectCustomerAgentDialog } = await import(
  "./disconnect-customer-agent-dialog"
);

afterAll(unregisterWorkspaceComponentTestEnv);
afterEach(cleanup);

const locale = "en-US";
const connection = { id: "consent-synthetic-1", name: "Synthetic Assistant" };

const renderDialog = (
  disconnect: (id: string) => Promise<CustomerAgentDisconnectResult>
) => {
  const onDisconnected = mock(() => undefined);
  const onClose = mock(() => undefined);
  const view = render(
    <DisconnectCustomerAgentDialog
      connection={connection}
      disconnect={disconnect}
      locale={locale}
      onClose={onClose}
      onDisconnected={onDisconnected}
    />
  );
  const confirmButton = () => {
    const element = view.baseElement.querySelector(
      "#disconnect-assistant-confirm"
    );
    if (!(element instanceof HTMLButtonElement)) {
      throw new Error("Missing the disconnect button");
    }
    return element;
  };
  const cancelButton = () =>
    view.getByRole("button", {
      name: m.accountAssistantDialogCancel({}, { locale }),
    }) as HTMLButtonElement;
  const failureShown = () =>
    view.baseElement.textContent?.includes(
      m.accountAssistantDisconnectFailed({}, { locale })
    ) ?? false;
  return {
    onDisconnected,
    onClose,
    confirmButton,
    cancelButton,
    failureShown,
  };
};

describe("DisconnectCustomerAgentDialog", () => {
  test("a failed disconnect keeps the dialog open until Cancel clears it", async () => {
    const dialog = renderDialog(() =>
      Promise.resolve<CustomerAgentDisconnectResult>("failed")
    );

    await act(async () => {
      fireEvent.click(dialog.confirmButton());
    });
    expect(dialog.onDisconnected).not.toHaveBeenCalled();
    expect(dialog.failureShown()).toBe(true);

    fireEvent.click(dialog.cancelButton());
    expect(dialog.onClose).toHaveBeenCalledTimes(1);
    expect(dialog.failureShown()).toBe(false);
  });

  test("can't close while the disconnect is pending", async () => {
    const pending = Promise.withResolvers<CustomerAgentDisconnectResult>();
    const disconnect = mock(() => pending.promise);
    const dialog = renderDialog(disconnect);

    await act(async () => {
      fireEvent.click(dialog.confirmButton());
    });
    expect(disconnect).toHaveBeenCalledWith(connection.id);
    expect(dialog.cancelButton().disabled).toBe(true);
    fireEvent.keyDown(dialog.confirmButton(), { key: "Escape" });
    expect(dialog.onClose).not.toHaveBeenCalled();

    await act(async () => {
      pending.resolve("disconnected");
      await pending.promise;
    });
    expect(dialog.onDisconnected).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(dialog.confirmButton(), { key: "Escape" });
    expect(dialog.onClose).toHaveBeenCalledTimes(1);
  });
});
