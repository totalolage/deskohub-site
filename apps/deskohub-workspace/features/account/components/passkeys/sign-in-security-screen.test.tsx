import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import type {
  AccountPasskey,
  PasskeyChangeResult,
  PasskeyConfirmationResult,
  PasskeyCreationResult,
} from "@/features/account/passkeys";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

// The screen's re-authentication runs through the confirmWithPasskey prop;
// no test here reaches the Better Auth browser client.
mock.module("@/features/account/auth.client", () => ({ authClient: {} }));

registerWorkspaceComponentTestEnv();
// @testing-library/react must load after the happy-dom registration.
const { act, cleanup, fireEvent, render } = await import(
  "@testing-library/react"
);
const { SignInSecurityScreen } = await import("./sign-in-security-screen");

afterAll(unregisterWorkspaceComponentTestEnv);
afterEach(cleanup);

const locale = "en-US";
const laptop: AccountPasskey = {
  id: "passkey-synthetic-1",
  name: "Synthetic laptop",
  provider: undefined,
  createdAt: "2026-10-01T09:30:00.000Z",
};
const phone: AccountPasskey = {
  id: "passkey-synthetic-2",
  name: "Synthetic phone",
  provider: "Synthetic provider",
  createdAt: "2026-10-02T09:30:00.000Z",
};

type ScreenOptions = {
  readonly passkeys?: readonly AccountPasskey[] | null;
  readonly createPasskey?: () => Promise<PasskeyCreationResult>;
  readonly confirmWithPasskey?: () => Promise<PasskeyConfirmationResult>;
  readonly renamePasskey?: (
    id: string,
    name: string
  ) => Promise<PasskeyChangeResult>;
  readonly deletePasskey?: (id: string) => Promise<PasskeyChangeResult>;
};

const renderScreen = ({
  passkeys = [laptop],
  createPasskey = () => Promise.resolve("created"),
  confirmWithPasskey,
  renamePasskey = () => Promise.resolve("saved"),
  deletePasskey = () => Promise.resolve("saved"),
}: ScreenOptions = {}) => {
  const view = render(
    <SignInSecurityScreen
      confirmWithPasskey={confirmWithPasskey}
      createPasskey={createPasskey}
      deletePasskey={deletePasskey}
      email="synthetic-member"
      locale={locale}
      passkeys={passkeys}
      renamePasskey={renamePasskey}
    />
  );
  const find = (selector: string) =>
    view.baseElement.querySelector<HTMLElement>(selector);
  const button = (selector: string) => {
    const element = find(selector);
    if (!(element instanceof HTMLButtonElement)) {
      throw new Error(`Missing button ${selector}`);
    }
    return element;
  };
  const click = async (selector: string) => {
    await act(async () => {
      fireEvent.click(button(selector));
    });
  };
  const status = () => find("#account-security-status")?.textContent ?? "";
  const dialog = () => view.baseElement.querySelector('[role="dialog"]');
  return { view, find, button, click, status, dialog };
};

const createFailed = m.accountPasskeyCreateFailed({}, { locale });

describe("SignInSecurityScreen", () => {
  test("says the passkeys couldn't be read, offering no way to add one", () => {
    const screen = renderScreen({ passkeys: null });

    expect(screen.find("#account-security-passkeys-unavailable")).not.toBe(
      null
    );
    expect(screen.find("#account-security-add-passkey")).toBe(null);
    expect(screen.find("ul")).toBe(null);
  });

  test("invites an account without passkeys to create its first", async () => {
    const createPasskey = mock(() =>
      Promise.resolve<PasskeyCreationResult>("created")
    );
    const screen = renderScreen({ passkeys: [], createPasskey });

    expect(screen.find("ul")).toBe(null);
    expect(screen.button("#account-security-add-passkey").textContent).toBe(
      m.accountPasskeyCreate({}, { locale })
    );

    await screen.click("#account-security-add-passkey");

    expect(createPasskey).toHaveBeenCalledTimes(1);
    expect(screen.status()).toBe(m.accountPasskeyCreated({}, { locale }));
    expect(screen.dialog()).toBe(null);
  });

  test("lists each passkey with its provider only when it differs from the name", () => {
    const providerNamed: AccountPasskey = {
      ...phone,
      id: "passkey-synthetic-3",
      name: phone.provider,
      createdAt: laptop.createdAt,
    };
    const screen = renderScreen({ passkeys: [laptop, phone, providerNamed] });

    const items = [...screen.view.baseElement.querySelectorAll("li")];
    expect(items.map((item) => item.dataset.passkeyId)).toEqual([
      laptop.id,
      phone.id,
      providerNamed.id,
    ]);
    const details = items.map(
      (item) => item.querySelectorAll("p")[1]?.textContent ?? ""
    );
    expect(details[1]).toContain(phone.provider ?? "");
    expect(details[2]).not.toContain(phone.provider ?? "");
    // Without a distinct provider, both show only their creation date.
    expect(details[2]).toBe(details[0] ?? "");
    expect(screen.button("#account-security-add-passkey").textContent).toBe(
      m.accountSecurityPasskeysAdd({}, { locale })
    );
  });

  test("disables adding while a passkey is being created", async () => {
    const pending = Promise.withResolvers<PasskeyCreationResult>();
    const screen = renderScreen({ createPasskey: () => pending.promise });

    await screen.click("#account-security-add-passkey");
    expect(screen.button("#account-security-add-passkey").disabled).toBe(true);
    expect(screen.button("#account-security-add-passkey").textContent).toBe(
      m.accountPasskeyCreating({}, { locale })
    );

    await act(async () => {
      pending.resolve("cancelled");
      await pending.promise;
    });
    expect(screen.button("#account-security-add-passkey").disabled).toBe(false);
    expect(screen.status()).toBe("");
  });

  test("announces a failed creation outside the dialog", async () => {
    const screen = renderScreen({
      createPasskey: () => Promise.resolve("failed"),
    });

    await screen.click("#account-security-add-passkey");

    expect(screen.status()).toBe(createFailed);
    expect(screen.dialog()).toBe(null);
  });

  test("confirms a stale session before a fresh click creates the passkey", async () => {
    const results: PasskeyCreationResult[] = [
      "reauthentication-required",
      "failed",
      "created",
    ];
    const createPasskey = mock(() =>
      Promise.resolve(results.shift() ?? "failed")
    );
    const screen = renderScreen({
      createPasskey,
      confirmWithPasskey: () => Promise.resolve("confirmed"),
    });

    await screen.click("#account-security-add-passkey");
    expect(screen.dialog()).not.toBe(null);
    expect(screen.find("#add-passkey-create")).toBe(null);

    await screen.click("#add-passkey-reauth-passkey");
    expect(createPasskey).toHaveBeenCalledTimes(1);

    await screen.click("#add-passkey-create");
    expect(screen.dialog()?.textContent).toContain(createFailed);
    expect(screen.status()).toBe("");

    await screen.click("#add-passkey-create");
    expect(createPasskey).toHaveBeenCalledTimes(3);
    expect(screen.dialog()).toBe(null);
    expect(screen.status()).toBe(m.accountPasskeyCreated({}, { locale }));
  });

  test("keeps the add dialog open while creating, and cancelling clears its failure", async () => {
    const pending = Promise.withResolvers<PasskeyCreationResult>();
    const results: Promise<PasskeyCreationResult>[] = [
      Promise.resolve("reauthentication-required"),
      Promise.resolve("failed"),
      pending.promise,
    ];
    const screen = renderScreen({
      createPasskey: () => results.shift() ?? Promise.resolve("failed"),
      confirmWithPasskey: () => Promise.resolve("confirmed"),
    });
    const cancel = () =>
      screen.view.getByRole("button", {
        name: m.accountPasskeyDialogCancel({}, { locale }),
      });

    await screen.click("#account-security-add-passkey");
    await screen.click("#add-passkey-reauth-passkey");
    await screen.click("#add-passkey-create");
    expect(screen.dialog()?.textContent).toContain(createFailed);

    await screen.click("#add-passkey-create");
    expect(screen.dialog()?.textContent).not.toContain(createFailed);
    expect(screen.button("#add-passkey-create").disabled).toBe(true);
    fireEvent.keyDown(screen.button("#add-passkey-create"), { key: "Escape" });
    expect(screen.dialog()).not.toBe(null);

    await act(async () => {
      pending.resolve("failed");
      await pending.promise;
    });
    expect(screen.dialog()?.textContent).toContain(createFailed);

    fireEvent.click(cancel());
    expect(screen.dialog()).toBe(null);

    // Reopening starts from re-authentication with no stale failure.
    results.push(Promise.resolve("reauthentication-required"));
    await screen.click("#account-security-add-passkey");
    await screen.click("#add-passkey-reauth-passkey");
    expect(screen.dialog()?.textContent).not.toContain(createFailed);
  });

  test("announces a renamed passkey", async () => {
    const renamePasskey = mock((_id: string, _name: string) =>
      Promise.resolve<PasskeyChangeResult>("saved")
    );
    const screen = renderScreen({ passkeys: [laptop, phone], renamePasskey });

    fireEvent.click(
      screen.view.getByRole("button", {
        name: m.accountSecurityPasskeyRenameLabel(
          { name: phone.name ?? "" },
          { locale }
        ),
      })
    );
    const input = screen.dialog()?.querySelector("input");
    if (!(input instanceof HTMLInputElement)) throw new Error("No name input");
    fireEvent.change(input, { target: { value: "Renamed phone" } });
    await act(async () => {
      fireEvent.submit(input.form as HTMLFormElement);
    });

    expect(renamePasskey).toHaveBeenCalledWith(phone.id, "Renamed phone");
    expect(screen.dialog()).toBe(null);
    expect(screen.status()).toBe(m.accountPasskeyRenamed({}, { locale }));
  });

  test("announces a deleted passkey, warning first when it is the last", async () => {
    const deletePasskey = mock((_id: string) =>
      Promise.resolve<PasskeyChangeResult>("saved")
    );
    const screen = renderScreen({ passkeys: [laptop], deletePasskey });

    fireEvent.click(
      screen.view.getByRole("button", {
        name: m.accountSecurityPasskeyDeleteLabel(
          { name: laptop.name ?? "" },
          { locale }
        ),
      })
    );
    expect(screen.dialog()?.textContent).toContain(
      m.accountPasskeyDeleteLastBody({}, { locale })
    );
    await screen.click("#delete-passkey-confirm");

    expect(deletePasskey).toHaveBeenCalledWith(laptop.id);
    expect(screen.dialog()).toBe(null);
    expect(screen.status()).toBe(m.accountPasskeyDeleted({}, { locale }));
  });
});
