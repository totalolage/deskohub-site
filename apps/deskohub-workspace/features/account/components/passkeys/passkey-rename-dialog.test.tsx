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
const { PasskeyRenameDialog } = await import("./passkey-rename-dialog");

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
  renamePasskey: (id: string, name: string) => Promise<PasskeyChangeResult>,
  shown: AccountPasskey | null = passkey
) => {
  const onRenamed = mock(() => undefined);
  const onClose = mock(() => undefined);
  const view = render(
    <PasskeyRenameDialog
      locale={locale}
      onClose={onClose}
      onRenamed={onRenamed}
      passkey={shown}
      renamePasskey={renamePasskey}
    />
  );
  const nameInput = () =>
    view.baseElement.querySelector<HTMLInputElement>("#rename-passkey-name");
  const save = async (name: string) => {
    const input = nameInput();
    if (input === null) throw new Error("Missing the name field");
    await act(async () => {
      fireEvent.change(input, { target: { value: name } });
    });
    const form = input.closest("form");
    if (form === null) throw new Error("Missing the rename form");
    await act(async () => {
      fireEvent.submit(form);
    });
  };
  const text = () => view.baseElement.textContent ?? "";
  return { onRenamed, onClose, nameInput, save, text };
};

describe("PasskeyRenameDialog", () => {
  test("stays closed without a passkey", () => {
    const dialog = renderDialog(() => Promise.resolve("saved"), null);

    expect(dialog.nameInput()).toBeNull();
  });

  test("starts from the passkey's display name", () => {
    const unnamed = renderDialog(() => Promise.resolve("saved"), {
      ...passkey,
      name: undefined,
    });

    expect(unnamed.nameInput()?.value).toBe(
      m.accountSecurityPasskeyDefaultName({}, { locale })
    );
  });

  test("saves a new, trimmed name and reports it renamed", async () => {
    const renamePasskey = mock(() =>
      Promise.resolve<PasskeyChangeResult>("saved")
    );
    const dialog = renderDialog(renamePasskey);

    await dialog.save("  Synthetic phone  ");

    expect(renamePasskey).toHaveBeenCalledWith(passkey.id, "Synthetic phone");
    expect(dialog.onRenamed).toHaveBeenCalledTimes(1);
    expect(dialog.onClose).not.toHaveBeenCalled();
  });

  test("an unchanged name closes without saving", async () => {
    const renamePasskey = mock(() =>
      Promise.resolve<PasskeyChangeResult>("saved")
    );
    const dialog = renderDialog(renamePasskey);

    await dialog.save(` ${passkey.name} `);

    expect(renamePasskey).not.toHaveBeenCalled();
    expect(dialog.onClose).toHaveBeenCalledTimes(1);
  });

  test("a failed save shows the failure until the next attempt", async () => {
    const renamePasskey = mock(() =>
      Promise.resolve<PasskeyChangeResult>("failed")
    );
    const dialog = renderDialog(renamePasskey);
    const failure = m.accountPasskeyRenameFailed({}, { locale });

    await dialog.save("Synthetic phone");
    expect(dialog.onRenamed).not.toHaveBeenCalled();
    expect(dialog.text()).toContain(failure);

    renamePasskey.mockImplementation(() => Promise.resolve("saved"));
    await dialog.save("Synthetic tablet");
    expect(dialog.text()).not.toContain(failure);
    expect(dialog.onRenamed).toHaveBeenCalledTimes(1);
  });

  test("an empty name is refused before saving", async () => {
    const renamePasskey = mock(() =>
      Promise.resolve<PasskeyChangeResult>("saved")
    );
    const dialog = renderDialog(renamePasskey);

    await dialog.save("   ");

    expect(renamePasskey).not.toHaveBeenCalled();
    expect(dialog.text()).toContain(
      m.accountPasskeyRenameRequired({}, { locale })
    );
  });

  test("Escape closes the dialog", () => {
    const dialog = renderDialog(() => Promise.resolve("saved"));
    const input = dialog.nameInput();
    if (input === null) throw new Error("Missing the name field");

    fireEvent.keyDown(input, { key: "Escape" });

    expect(dialog.onClose).toHaveBeenCalledTimes(1);
  });
});
