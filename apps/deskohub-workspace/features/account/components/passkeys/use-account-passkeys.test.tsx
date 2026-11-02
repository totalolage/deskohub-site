import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import type { PasskeyCreation } from "@/features/account/passkey-client";
import type {
  AccountPasskey,
  PasskeyChangeResult,
  PasskeyConfirmationResult,
} from "@/features/account/passkeys";
import type { PasskeyAddedSource } from "@/features/account/sign-in-analytics";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const accountId = "account-synthetic-1";
const laptop: AccountPasskey = {
  id: "passkey-synthetic-1",
  name: "Synthetic laptop",
  provider: undefined,
  createdAt: "2026-10-01T09:30:00.000Z",
};
const phone: AccountPasskey = {
  id: "passkey-synthetic-2",
  name: undefined,
  provider: "Synthetic provider",
  createdAt: "2026-10-02T09:30:00.000Z",
};

const createPasskey = mock(
  (_accountId: string): Promise<PasskeyCreation> =>
    Promise.resolve({ result: "created", passkey: undefined })
);
const deletePasskey = mock(
  (_id: string): Promise<PasskeyChangeResult> => Promise.resolve("saved")
);
const renamePasskey = mock(
  (_id: string, _name: string): Promise<PasskeyChangeResult> =>
    Promise.resolve("saved")
);
const confirmWithPasskey = mock(
  (): Promise<PasskeyConfirmationResult> => Promise.resolve("confirmed")
);
const capturePasskeyAdded = mock((_source: PasskeyAddedSource) => undefined);
const capturePasskeyRemoved = mock(() => undefined);
const forgetPasskeyOnThisBrowser = mock((_accountId: string) => undefined);

const signInAnalytics = await import("@/features/account/sign-in-analytics");
const passkeyPrompt = await import("@/features/account/passkey-prompt");
const passkeyClient = await import("@/features/account/passkey-client");
mock.module("@/features/account/passkey-client", () => ({
  ...passkeyClient,
  confirmWithPasskey,
  createPasskey,
  deletePasskey,
  renamePasskey,
}));
mock.module("@/features/account/sign-in-analytics", () => ({
  ...signInAnalytics,
  capturePasskeyAdded,
  capturePasskeyRemoved,
}));
mock.module("@/features/account/passkey-prompt", () => ({
  ...passkeyPrompt,
  forgetPasskeyOnThisBrowser,
}));

registerWorkspaceComponentTestEnv();
// @testing-library/react must load after the happy-dom registration.
const { act, cleanup, renderHook } = await import("@testing-library/react");
const { useAccountPasskeys } = await import("./use-account-passkeys");

afterAll(unregisterWorkspaceComponentTestEnv);
afterEach(cleanup);
beforeEach(() => {
  for (const fn of [
    createPasskey,
    deletePasskey,
    renamePasskey,
    confirmWithPasskey,
    capturePasskeyAdded,
    capturePasskeyRemoved,
    forgetPasskeyOnThisBrowser,
  ]) {
    fn.mockClear();
  }
});

const renderAccountPasskeys = (passkeys: readonly AccountPasskey[] | null) => {
  const { result } = renderHook(() =>
    useAccountPasskeys({ accountId, passkeys })
  );
  const current = () => {
    if (result.current === undefined) throw new Error("No account passkeys");
    return result.current;
  };
  return { current };
};

describe("useAccountPasskeys", () => {
  test("has nothing to offer without passkey settings", () => {
    const { result } = renderHook(() => useAccountPasskeys(undefined));
    expect(result.current).toBeUndefined();
  });

  test("offers passkey confirmation only while the account has passkeys", () => {
    expect(renderAccountPasskeys([laptop]).current().confirmWithPasskey).toBe(
      confirmWithPasskey
    );
    expect(
      renderAccountPasskeys([]).current().confirmWithPasskey
    ).toBeUndefined();
    expect(
      renderAccountPasskeys(null).current().confirmWithPasskey
    ).toBeUndefined();
  });

  describe("createPasskey", () => {
    test("adds the created passkey to the list and records its source", async () => {
      createPasskey.mockImplementationOnce(() =>
        Promise.resolve({ result: "created", passkey: phone })
      );
      const hook = renderAccountPasskeys([laptop]);

      let result: unknown;
      await act(async () => {
        result = await hook.current().createPasskey("settings");
      });

      expect(result).toBe("created");
      expect(createPasskey).toHaveBeenCalledWith(accountId);
      expect(capturePasskeyAdded).toHaveBeenCalledWith("settings");
      expect(hook.current().passkeys).toEqual([laptop, phone]);
    });

    test("records a creation the server returned no passkey for, leaving the list", async () => {
      const hook = renderAccountPasskeys([laptop]);

      await act(async () => {
        await hook.current().createPasskey("prompt");
      });

      expect(capturePasskeyAdded).toHaveBeenCalledWith("prompt");
      expect(hook.current().passkeys).toEqual([laptop]);
    });

    test("keeps an unreadable list unreadable after a creation", async () => {
      createPasskey.mockImplementationOnce(() =>
        Promise.resolve({ result: "created", passkey: phone })
      );
      const hook = renderAccountPasskeys(null);

      await act(async () => {
        await hook.current().createPasskey("settings");
      });

      expect(hook.current().passkeys).toBeNull();
    });

    test("returns any other outcome without recording or listing a passkey", async () => {
      createPasskey.mockImplementationOnce(() =>
        Promise.resolve({ result: "reauthentication-required" })
      );
      const hook = renderAccountPasskeys([laptop]);

      let result: unknown;
      await act(async () => {
        result = await hook.current().createPasskey("settings");
      });

      expect(result).toBe("reauthentication-required");
      expect(capturePasskeyAdded).not.toHaveBeenCalled();
      expect(hook.current().passkeys).toEqual([laptop]);
    });
  });

  describe("renamePasskey", () => {
    test("renames the saved passkey in place", async () => {
      const hook = renderAccountPasskeys([laptop, phone]);

      await act(async () => {
        await hook.current().renamePasskey(phone.id, "Synthetic phone");
      });

      expect(renamePasskey).toHaveBeenCalledWith(phone.id, "Synthetic phone");
      expect(hook.current().passkeys).toEqual([
        laptop,
        { ...phone, name: "Synthetic phone" },
      ]);
    });

    test("keeps the list when the rename fails", async () => {
      renamePasskey.mockImplementationOnce(() => Promise.resolve("failed"));
      const hook = renderAccountPasskeys([laptop]);

      let result: unknown;
      await act(async () => {
        result = await hook.current().renamePasskey(laptop.id, "Other");
      });

      expect(result).toBe("failed");
      expect(hook.current().passkeys).toEqual([laptop]);
    });
  });

  describe("deletePasskey", () => {
    test("removes the deleted passkey and records the removal", async () => {
      const hook = renderAccountPasskeys([laptop, phone]);

      let result: unknown;
      await act(async () => {
        result = await hook.current().deletePasskey(laptop.id);
      });

      expect(result).toBe("saved");
      expect(deletePasskey).toHaveBeenCalledWith(laptop.id);
      expect(capturePasskeyRemoved).toHaveBeenCalledTimes(1);
      expect(hook.current().passkeys).toEqual([phone]);
      expect(forgetPasskeyOnThisBrowser).not.toHaveBeenCalled();
    });

    test("forgets this browser's passkey once the last one is deleted", async () => {
      const hook = renderAccountPasskeys([laptop]);

      await act(async () => {
        await hook.current().deletePasskey(laptop.id);
      });

      expect(hook.current().passkeys).toEqual([]);
      expect(forgetPasskeyOnThisBrowser).toHaveBeenCalledWith(accountId);
      expect(hook.current().confirmWithPasskey).toBeUndefined();
    });

    test("keeps an unreadable list unreadable after a deletion", async () => {
      const hook = renderAccountPasskeys(null);

      await act(async () => {
        await hook.current().deletePasskey(laptop.id);
      });

      expect(capturePasskeyRemoved).toHaveBeenCalledTimes(1);
      expect(hook.current().passkeys).toBeNull();
      expect(forgetPasskeyOnThisBrowser).not.toHaveBeenCalled();
    });

    test("returns a failed deletion without recording or changing the list", async () => {
      deletePasskey.mockImplementationOnce(() => Promise.resolve("failed"));
      const hook = renderAccountPasskeys([laptop]);

      let result: unknown;
      await act(async () => {
        result = await hook.current().deletePasskey(laptop.id);
      });

      expect(result).toBe("failed");
      expect(capturePasskeyRemoved).not.toHaveBeenCalled();
      expect(hook.current().passkeys).toEqual([laptop]);
    });
  });
});
