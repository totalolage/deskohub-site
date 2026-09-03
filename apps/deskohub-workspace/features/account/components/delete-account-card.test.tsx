import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import React from "react";
import { workspaceRouterRefresh } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

type ActionResult = {
  data?: { status?: string };
  serverError?: string;
  validationErrors?: unknown;
};

const deleteCustomerAccount = mock(() =>
  Promise.resolve({ data: { status: "deleted" } as const })
);
mock.module("@/features/account/actions", () => ({
  deleteCustomerAccount,
}));

const signInMagicLink = mock(() => Promise.resolve({ error: null }));
mock.module("@/features/account/auth.client", () => ({
  authClient: {
    signIn: { magicLink: signInMagicLink },
    signOut: () => Promise.resolve({ error: null }),
    getSession: () => Promise.resolve({ data: null, error: null }),
  },
}));

mock.module("@/shared/utils/use-workspace-action", () => ({
  useWorkspaceAction: (
    action: (input: never) => Promise<unknown>,
    options?: {
      readonly onSuccess?: (args: { readonly data?: unknown }) => void;
    }
  ) => {
    const [result, setResult] = React.useState<ActionResult>({});
    const [isExecuting, setExecuting] = React.useState(false);
    return {
      result,
      isExecuting,
      execute: (input: never) => {
        setExecuting(true);
        void action(input).then((outcome) => {
          setExecuting(false);
          setResult((outcome ?? {}) as ActionResult);
          options?.onSuccess?.({
            data: (outcome as { data?: unknown })?.data,
          });
        });
      },
      reset: () => setResult({}),
    };
  },
}));

describe("DeleteAccountCard", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
    deleteCustomerAccount.mockClear();
    signInMagicLink.mockClear();
    workspaceRouterRefresh.mockClear();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  const openDialog = async (view: ReturnType<typeof render>) => {
    await act(async () => {
      fireEvent.click(view.getByText("Delete my account"));
    });
  };

  test("keeps the destructive confirmation disabled until the checkbox is checked", async () => {
    const { DeleteAccountCard } = await import("./delete-account-card");

    const view = render(
      <DeleteAccountCard
        email="ada@example.test"
        locale="en-US"
        deletionPending={false}
      />
    );
    await openDialog(view);

    const confirm = view.getByText("Delete permanently") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    const checkbox = view.getByLabelText(
      "I understand that my account and every session will be permanently deleted."
    );
    await act(async () => {
      fireEvent.click(checkbox);
    });
    expect(
      (view.getByText("Delete permanently") as HTMLButtonElement).disabled
    ).toBe(false);

    expect(view.getByText("Keep account")).toBeTruthy();
  });

  test("redirects to the deleted page after a successful deletion", async () => {
    const { DeleteAccountCard } = await import("./delete-account-card");

    let assigned: string | null = null;
    const originalAssign = window.location.assign;
    window.location.assign = ((href: string) => {
      assigned = href;
    }) as typeof window.location.assign;

    const view = render(
      <DeleteAccountCard
        email="ada@example.test"
        locale="en-US"
        deletionPending={false}
      />
    );
    await openDialog(view);
    await act(async () => {
      fireEvent.click(
        view.getByLabelText(
          "I understand that my account and every session will be permanently deleted."
        )
      );
    });
    await act(async () => {
      fireEvent.click(view.getByText("Delete permanently"));
    });

    expect(deleteCustomerAccount).toHaveBeenCalledWith({ confirmed: true });
    expect(assigned).toBe("/en-US/account/deleted");
    window.location.assign = originalAssign;
  });

  test("switches to the reauthentication state on a stale session and sends a new link", async () => {
    deleteCustomerAccount.mockImplementationOnce(() =>
      Promise.resolve({ data: { status: "reauthentication-required" } })
    );
    const { DeleteAccountCard } = await import("./delete-account-card");

    const view = render(
      <DeleteAccountCard
        email="ada@example.test"
        locale="en-US"
        deletionPending={false}
      />
    );
    await openDialog(view);
    await act(async () => {
      fireEvent.click(
        view.getByLabelText(
          "I understand that my account and every session will be permanently deleted."
        )
      );
    });
    await act(async () => {
      fireEvent.click(view.getByText("Delete permanently"));
    });

    expect(view.getByText("Sign in again to delete")).toBeTruthy();
    expect(
      view.getByText(
        "Your sign-in is too old for deleting the account. Use a new magic link, then confirm the deletion again."
      )
    ).toBeTruthy();

    await act(async () => {
      fireEvent.click(view.getByText("Email me a new link"));
    });

    expect(signInMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "ada@example.test",
        callbackURL: "/en-US/auth/callback",
      })
    );
    expect(view.getByText(/a new link is on its way/)).toBeTruthy();
  });

  test("shows the retryable error when the deletion endpoint fails", async () => {
    deleteCustomerAccount.mockImplementationOnce(() =>
      Promise.resolve({ data: { status: "failed" } })
    );
    const { DeleteAccountCard } = await import("./delete-account-card");

    const view = render(
      <DeleteAccountCard
        email="ada@example.test"
        locale="en-US"
        deletionPending={false}
      />
    );
    await openDialog(view);
    await act(async () => {
      fireEvent.click(
        view.getByLabelText(
          "I understand that my account and every session will be permanently deleted."
        )
      );
    });
    await act(async () => {
      fireEvent.click(view.getByText("Delete permanently"));
    });

    expect(
      view.getByText(
        "We could not expire your customer profile, so your account was not deleted. Please try again when our reservation system recovers."
      )
    ).toBeTruthy();
    expect(
      (view.getByText("Delete permanently") as HTMLButtonElement).disabled
    ).toBe(false);
  });

  test("renders the pending-deletion copy while a retryable deletion marker is set", async () => {
    const { DeleteAccountCard } = await import("./delete-account-card");

    const view = render(
      <DeleteAccountCard
        email="ada@example.test"
        locale="en-US"
        deletionPending
      />
    );
    expect(view.getByText("Account deletion is pending")).toBeTruthy();
    expect(
      view.getByText(
        "We could not finish deleting your account because our reservation system did not respond. You can sign out, or try deleting it again."
      )
    ).toBeTruthy();

    await act(async () => {
      fireEvent.click(view.getByText("Delete permanently"));
    });
    expect(view.getByText("Permanently delete this account?")).toBeTruthy();
  });
});
