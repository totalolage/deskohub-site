import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import type {
  AccountPasskey,
  PasskeyChangeResult,
} from "@/features/account/passkeys";
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
const { PasskeyDeleteDialog } = await import("./passkey-delete-dialog");

afterAll(unregisterWorkspaceComponentTestEnv);
afterEach(cleanup);

const locale = "en-US";
const passkey: AccountPasskey = {
  id: "passkey-synthetic-1",
  name: "Synthetic laptop",
  provider: undefined,
  createdAt: "2026-10-01T09:30:00.000Z",
};

const renderDialog = (
  deletePasskey: (id: string) => Promise<PasskeyChangeResult>,
  { last = false }: { readonly last?: boolean } = {}
) => {
  const onDeleted = mock(() => undefined);
  const onClose = mock(() => undefined);
  const view = render(
    <PasskeyDeleteDialog
      deletePasskey={deletePasskey}
      last={last}
      locale={locale}
      onClose={onClose}
      onDeleted={onDeleted}
      passkey={passkey}
    />
  );
  const button = (selector: string) => {
    const element = view.baseElement.querySelector(selector);
    if (!(element instanceof HTMLButtonElement)) {
      throw new Error(`Missing button ${selector}`);
    }
    return element;
  };
  const confirmButton = () => button("#delete-passkey-confirm");
  const cancelButton = () =>
    view.getByRole("button", {
      name: m.accountPasskeyDialogCancel({}, { locale }),
    }) as HTMLButtonElement;
  const failureShown = () =>
    view.baseElement.textContent?.includes(
      m.accountPasskeyDeleteFailed({}, { locale })
    ) ?? false;
  return {
    view,
    onDeleted,
    onClose,
    confirmButton,
    cancelButton,
    failureShown,
  };
};

describe("PasskeyDeleteDialog", () => {
  test("deletes the shown passkey and reports it deleted", async () => {
    const deletePasskey = mock(() =>
      Promise.resolve<PasskeyChangeResult>("saved")
    );
    const dialog = renderDialog(deletePasskey);

    await act(async () => {
      fireEvent.click(dialog.confirmButton());
    });

    expect(deletePasskey).toHaveBeenCalledWith(passkey.id);
    expect(dialog.onDeleted).toHaveBeenCalledTimes(1);
    expect(dialog.failureShown()).toBe(false);
  });

  test("keeps the dialog open with a failure, which closing clears", async () => {
    const dialog = renderDialog(() =>
      Promise.resolve<PasskeyChangeResult>("failed")
    );

    await act(async () => {
      fireEvent.click(dialog.confirmButton());
    });
    expect(dialog.onDeleted).not.toHaveBeenCalled();
    expect(dialog.failureShown()).toBe(true);

    fireEvent.click(dialog.cancelButton());
    expect(dialog.onClose).toHaveBeenCalledTimes(1);
    expect(dialog.failureShown()).toBe(false);
  });

  test("can't close while the deletion is pending", async () => {
    const pending = Promise.withResolvers<PasskeyChangeResult>();
    const dialog = renderDialog(() => pending.promise);

    await act(async () => {
      fireEvent.click(dialog.confirmButton());
    });
    expect(dialog.confirmButton().disabled).toBe(true);
    expect(dialog.cancelButton().disabled).toBe(true);
    fireEvent.keyDown(dialog.confirmButton(), { key: "Escape" });
    expect(dialog.onClose).not.toHaveBeenCalled();

    await act(async () => {
      pending.resolve("saved");
      await pending.promise;
    });
    expect(dialog.confirmButton().disabled).toBe(false);
    fireEvent.keyDown(dialog.confirmButton(), { key: "Escape" });
    expect(dialog.onClose).toHaveBeenCalledTimes(1);
  });

  test("warns only when deleting the account's last passkey", () => {
    const lastWarning = m.accountPasskeyDeleteLastBody({}, { locale });
    const notLast = renderDialog(() => Promise.resolve("saved"));
    expect(notLast.view.baseElement.textContent).not.toContain(lastWarning);
    cleanup();

    const last = renderDialog(() => Promise.resolve("saved"), { last: true });
    expect(last.view.baseElement.textContent).toContain(lastWarning);
  });
});
