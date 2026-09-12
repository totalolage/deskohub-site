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
import { type Locale, m } from "@/features/i18n";
import {
  UnsavedChangesProvider,
  useUnsavedChanges,
} from "@/shared/components/unsaved-changes-guard";
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

const deleteCustomerAccount = mock(
  (): Promise<ActionResult> => Promise.resolve({ data: { status: "deleted" } })
);
const analyticsEvents: string[] = [];
const beginAnalyticsAccountTransition = mock(() => {
  analyticsEvents.push("begin");
});
const completeAnalyticsAccountSignOut = mock(() => {
  analyticsEvents.push("complete");
});
const refreshAnalyticsAccountIdentity = mock(() => Promise.resolve());
mock.module("@/features/account/actions", () => ({
  deleteCustomerAccount,
}));

mock.module("@/features/account/analytics-identity", () => ({
  beginAnalyticsAccountTransition,
  completeAnalyticsAccountSignOut,
  refreshAnalyticsAccountIdentity,
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
      readonly onError?: (args: { readonly error: ActionResult }) => void;
      readonly onTransportError?: (args: {
        readonly error: unknown;
        readonly input: never;
      }) => void;
    }
  ) => {
    const [result, setResult] = React.useState<ActionResult>({});
    const [isExecuting, setExecuting] = React.useState(false);
    return {
      result,
      isExecuting,
      execute: (input: never) => {
        setExecuting(true);
        void action(input)
          .then((outcome) => {
            setExecuting(false);
            const result = (outcome ?? {}) as ActionResult;
            setResult(result);
            if (
              result.serverError !== undefined ||
              result.validationErrors !== undefined
            ) {
              options?.onError?.({ error: result });
            } else {
              options?.onSuccess?.({ data: result.data });
            }
          })
          .catch((error) => {
            setExecuting(false);
            setResult({});
            options?.onTransportError?.({ error, input });
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
    analyticsEvents.length = 0;
    beginAnalyticsAccountTransition.mockClear();
    completeAnalyticsAccountSignOut.mockClear();
    refreshAnalyticsAccountIdentity.mockClear();
    deleteCustomerAccount.mockClear();
    signInMagicLink.mockClear();
    workspaceRouterRefresh.mockClear();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  const openDialog = async (
    view: ReturnType<typeof render>,
    locale: Locale = "en-US"
  ) => {
    await act(async () => {
      fireEvent.click(
        view.getByRole("button", {
          name: m.accountDeletionButton({}, { locale }),
        })
      );
    });
  };

  function DirtyForm() {
    useUnsavedChanges({
      enabled: true,
      isDirty: () => true,
      message: "Leave this form?",
    });
    return null;
  }

  function dispatchBeforeUnload(): Event {
    const event = new Event("beforeunload", { cancelable: true });
    Object.defineProperty(event, "returnValue", {
      configurable: true,
      value: "",
      writable: true,
    });
    window.dispatchEvent(event);
    return event;
  }

  test("renders an optional h2 heading and keeps the default heading compatible", async () => {
    const { DeleteAccountCard } = await import("./delete-account-card");

    const view = render(
      <DeleteAccountCard
        email="ada@example.test"
        locale="en-US"
        deletionPending={false}
        heading="Synthetic danger heading"
      />
    );
    expect(
      view.getByRole("heading", {
        level: 2,
        name: "Synthetic danger heading",
      })
    ).toBeTruthy();
    expect(
      view.getByRole("heading", {
        level: 3,
        name: m.accountDeletionTitle({}, { locale: "en-US" }),
      })
    ).toBeTruthy();

    view.rerender(
      <DeleteAccountCard
        email="ada@example.test"
        locale="en-US"
        deletionPending={false}
      />
    );
    expect(
      view.getByRole("heading", {
        level: 2,
        name: m.accountDeletionTitle({}, { locale: "en-US" }),
      })
    ).toBeTruthy();
  });

  test.each(["en-US", "cs-CZ"] as const)(
    "shows the truthful normal deletion notice in %s",
    async (locale) => {
      const { DeleteAccountCard } = await import("./delete-account-card");

      const view = render(
        <DeleteAccountCard
          email="ada@example.test"
          locale={locale}
          deletionPending={false}
        />
      );
      expect(
        view.getByText(m.accountDeletionDescription({}, { locale }))
      ).toBeTruthy();
    }
  );

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
    deleteCustomerAccount.mockImplementationOnce(() => {
      analyticsEvents.push("request");
      return Promise.resolve({ data: { status: "deleted" } });
    });
    const { DeleteAccountCard } = await import("./delete-account-card");

    let assigned: string | null = null;
    const originalAssign = window.location.assign;
    window.location.assign = ((href: string) => {
      analyticsEvents.push("navigation");
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
    expect(analyticsEvents).toEqual([
      "begin",
      "request",
      "complete",
      "navigation",
    ]);
    expect(beginAnalyticsAccountTransition).toHaveBeenCalledTimes(1);
    expect(completeAnalyticsAccountSignOut).toHaveBeenCalledTimes(1);
    expect(refreshAnalyticsAccountIdentity).not.toHaveBeenCalled();
    expect(assigned).toBe("/en-US/account/deleted");
    window.location.assign = originalAssign;
  });

  test("allows one unload after explicit deletion succeeds", async () => {
    const { DeleteAccountCard } = await import("./delete-account-card");

    let assigned: string | null = null;
    const originalAssign = window.location.assign;
    window.location.assign = ((href: string) => {
      assigned = href;
    }) as typeof window.location.assign;

    try {
      const view = render(
        <UnsavedChangesProvider>
          <DirtyForm />
          <DeleteAccountCard
            email="ada@example.test"
            locale="en-US"
            deletionPending={false}
          />
        </UnsavedChangesProvider>
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

      expect(assigned).toBe("/en-US/account/deleted");
      expect(beginAnalyticsAccountTransition).toHaveBeenCalledTimes(1);
      expect(completeAnalyticsAccountSignOut).toHaveBeenCalledTimes(1);
      expect(refreshAnalyticsAccountIdentity).not.toHaveBeenCalled();
      expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
      expect(dispatchBeforeUnload().defaultPrevented).toBe(true);
    } finally {
      window.location.assign = originalAssign;
    }
  });

  test("does not allow an unload when deletion is cancelled", async () => {
    const { DeleteAccountCard } = await import("./delete-account-card");
    const view = render(
      <UnsavedChangesProvider>
        <DirtyForm />
        <DeleteAccountCard
          email="ada@example.test"
          locale="en-US"
          deletionPending={false}
        />
      </UnsavedChangesProvider>
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
      fireEvent.click(view.getByText("Keep account"));
    });

    expect(deleteCustomerAccount).not.toHaveBeenCalled();
    expect(beginAnalyticsAccountTransition).not.toHaveBeenCalled();
    expect(completeAnalyticsAccountSignOut).not.toHaveBeenCalled();
    expect(refreshAnalyticsAccountIdentity).not.toHaveBeenCalled();
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);
  });

  test("switches to the reauthentication state on a stale session and sends a new link", async () => {
    deleteCustomerAccount.mockImplementationOnce(() =>
      Promise.resolve({ data: { status: "reauthentication-required" } })
    );
    const { DeleteAccountCard } = await import("./delete-account-card");

    const view = render(
      <UnsavedChangesProvider>
        <DirtyForm />
        <DeleteAccountCard
          email="ada@example.test"
          locale="en-US"
          deletionPending={false}
        />
      </UnsavedChangesProvider>
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

    expect(beginAnalyticsAccountTransition).toHaveBeenCalledTimes(1);
    expect(completeAnalyticsAccountSignOut).not.toHaveBeenCalled();
    expect(refreshAnalyticsAccountIdentity).toHaveBeenCalledTimes(1);
    expect(refreshAnalyticsAccountIdentity).toHaveBeenCalledWith({
      settleTransition: true,
    });
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);
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

  test("keeps the reauthentication request disabled until the link request resolves", async () => {
    deleteCustomerAccount.mockImplementationOnce(() =>
      Promise.resolve({ data: { status: "reauthentication-required" } })
    );
    let resolveLink!: (result: { error: null }) => void;
    const pendingLink = new Promise<{ error: null }>((resolve) => {
      resolveLink = resolve;
    });
    signInMagicLink.mockImplementationOnce(() => pendingLink);
    const { DeleteAccountCard } = await import("./delete-account-card");

    const view = render(
      <UnsavedChangesProvider>
        <DirtyForm />
        <DeleteAccountCard
          email="ada@example.test"
          locale="en-US"
          deletionPending={false}
        />
      </UnsavedChangesProvider>
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

    expect(beginAnalyticsAccountTransition).toHaveBeenCalledTimes(1);
    expect(completeAnalyticsAccountSignOut).not.toHaveBeenCalled();
    expect(refreshAnalyticsAccountIdentity).toHaveBeenCalledTimes(1);
    expect(refreshAnalyticsAccountIdentity).toHaveBeenCalledWith({
      settleTransition: true,
    });
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);
    const send = view.getByRole("button", {
      name: "Email me a new link",
    }) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(send);
      await Promise.resolve();
    });

    expect(send.disabled).toBe(true);
    expect(signInMagicLink).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveLink({ error: null });
      await pendingLink;
    });

    expect(view.getByText(/a new link is on its way/)).toBeTruthy();
  });

  test("reports a resolved reauthentication error and re-enables the button", async () => {
    deleteCustomerAccount.mockImplementationOnce(() =>
      Promise.resolve({ data: { status: "reauthentication-required" } })
    );
    signInMagicLink.mockImplementationOnce(() =>
      Promise.resolve({ error: { message: "rate limited" } })
    );
    const { DeleteAccountCard } = await import("./delete-account-card");

    const view = render(
      <UnsavedChangesProvider>
        <DirtyForm />
        <DeleteAccountCard
          email="ada@example.test"
          locale="en-US"
          deletionPending={false}
        />
      </UnsavedChangesProvider>
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

    expect(beginAnalyticsAccountTransition).toHaveBeenCalledTimes(1);
    expect(completeAnalyticsAccountSignOut).not.toHaveBeenCalled();
    expect(refreshAnalyticsAccountIdentity).toHaveBeenCalledTimes(1);
    expect(refreshAnalyticsAccountIdentity).toHaveBeenCalledWith({
      settleTransition: true,
    });
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);
    await act(async () => {
      fireEvent.click(
        view.getByRole("button", { name: "Email me a new link" })
      );
    });

    expect(view.getByRole("alert").textContent).toBe(
      "We could not send the link. Please try again."
    );
    expect(
      (
        view.getByRole("button", {
          name: "Email me a new link",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
    expect(view.queryByText(/a new link is on its way/)).toBeNull();
  });

  test("reports rejected reauthentication and succeeds on retry", async () => {
    deleteCustomerAccount.mockImplementationOnce(() =>
      Promise.resolve({ data: { status: "reauthentication-required" } })
    );
    let rejectLink!: (reason: Error) => void;
    const rejectedLink = new Promise<{ error: null }>((_, reject) => {
      rejectLink = reject;
    });
    signInMagicLink
      .mockImplementationOnce(() => rejectedLink)
      .mockImplementationOnce(() => Promise.resolve({ error: null }));
    const { DeleteAccountCard } = await import("./delete-account-card");

    const view = render(
      <UnsavedChangesProvider>
        <DirtyForm />
        <DeleteAccountCard
          email="ada@example.test"
          locale="en-US"
          deletionPending={false}
        />
      </UnsavedChangesProvider>
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

    expect(beginAnalyticsAccountTransition).toHaveBeenCalledTimes(1);
    expect(completeAnalyticsAccountSignOut).not.toHaveBeenCalled();
    expect(refreshAnalyticsAccountIdentity).toHaveBeenCalledTimes(1);
    expect(refreshAnalyticsAccountIdentity).toHaveBeenCalledWith({
      settleTransition: true,
    });
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);
    const send = view.getByRole("button", {
      name: "Email me a new link",
    }) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(send);
      await Promise.resolve();
    });
    expect(send.disabled).toBe(true);

    await act(async () => {
      rejectLink(new Error("provider failure"));
      await rejectedLink.catch(() => undefined);
    });

    expect(view.getByRole("alert").textContent).toBe(
      "We could not send the link. Please try again."
    );
    expect(send.disabled).toBe(false);
    expect(view.getByRole("alert").textContent).not.toContain(
      "provider failure"
    );

    await act(async () => {
      fireEvent.click(send);
    });

    expect(signInMagicLink).toHaveBeenCalledTimes(2);
    expect(view.getByText(/a new link is on its way/)).toBeTruthy();
    expect(send.disabled).toBe(true);
  });

  test("shows the retryable error when the deletion endpoint fails", async () => {
    deleteCustomerAccount.mockImplementationOnce(() =>
      Promise.resolve({ data: { status: "failed" } })
    );
    const { DeleteAccountCard } = await import("./delete-account-card");

    const view = render(
      <UnsavedChangesProvider>
        <DirtyForm />
        <DeleteAccountCard
          email="ada@example.test"
          locale="en-US"
          deletionPending={false}
        />
      </UnsavedChangesProvider>
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

    expect(beginAnalyticsAccountTransition).toHaveBeenCalledTimes(1);
    expect(completeAnalyticsAccountSignOut).not.toHaveBeenCalled();
    expect(refreshAnalyticsAccountIdentity).toHaveBeenCalledTimes(1);
    expect(refreshAnalyticsAccountIdentity).toHaveBeenCalledWith({
      settleTransition: true,
    });
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);
    expect(
      view.getByText(
        "We could not expire your customer profile, so your account was not deleted. Please try again when our reservation system recovers."
      )
    ).toBeTruthy();
    expect(
      (view.getByText("Delete permanently") as HTMLButtonElement).disabled
    ).toBe(false);
  });

  test("shows an explicit server error while keeping the dialog open", async () => {
    const serverError = "Synthetic deletion server failure";
    deleteCustomerAccount.mockImplementationOnce(() =>
      Promise.resolve({ serverError })
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
          m.accountDeletionConfirmLabel({}, { locale: "en-US" })
        )
      );
    });
    await act(async () => {
      fireEvent.click(
        view.getByRole("button", {
          name: m.accountDeletionConfirm({}, { locale: "en-US" }),
        })
      );
    });

    expect(view.getByText(serverError)).toBeTruthy();
    expect(view.getByRole("dialog")).toBeTruthy();
    expect(beginAnalyticsAccountTransition).toHaveBeenCalledTimes(1);
    expect(completeAnalyticsAccountSignOut).not.toHaveBeenCalled();
    expect(refreshAnalyticsAccountIdentity).toHaveBeenCalledTimes(1);
    expect(refreshAnalyticsAccountIdentity).toHaveBeenCalledWith({
      settleTransition: true,
    });
  });

  test("refreshes identity after a transport error without completing sign-out", async () => {
    deleteCustomerAccount.mockImplementationOnce(() =>
      Promise.reject(new Error("synthetic transport failure"))
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
          m.accountDeletionConfirmLabel({}, { locale: "en-US" })
        )
      );
    });
    await act(async () => {
      fireEvent.click(
        view.getByRole("button", {
          name: m.accountDeletionConfirm({}, { locale: "en-US" }),
        })
      );
      await Promise.resolve();
    });

    expect(beginAnalyticsAccountTransition).toHaveBeenCalledTimes(1);
    expect(completeAnalyticsAccountSignOut).not.toHaveBeenCalled();
    expect(refreshAnalyticsAccountIdentity).toHaveBeenCalledTimes(1);
    expect(refreshAnalyticsAccountIdentity).toHaveBeenCalledWith({
      settleTransition: true,
    });
    expect(view.getByRole("dialog")).toBeTruthy();
  });

  test("keeps the deletion confirmation disabled while the request is in flight", async () => {
    let resolveDeletion!: (result: ActionResult) => void;
    const pendingDeletion = new Promise<ActionResult>((resolve) => {
      resolveDeletion = resolve;
    });
    deleteCustomerAccount.mockImplementationOnce(() => pendingDeletion);
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
          m.accountDeletionConfirmLabel({}, { locale: "en-US" })
        )
      );
    });

    const confirm = view.getByRole("button", {
      name: m.accountDeletionConfirm({}, { locale: "en-US" }),
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(confirm);
    });
    expect(confirm.disabled).toBe(true);

    await act(async () => {
      resolveDeletion({ data: { status: "failed" } });
      await pendingDeletion;
    });
    expect(
      (
        view.getByRole("button", {
          name: m.accountDeletionConfirm({}, { locale: "en-US" }),
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
    expect(beginAnalyticsAccountTransition).toHaveBeenCalledTimes(1);
    expect(completeAnalyticsAccountSignOut).not.toHaveBeenCalled();
    expect(refreshAnalyticsAccountIdentity).toHaveBeenCalledTimes(1);
    expect(refreshAnalyticsAccountIdentity).toHaveBeenCalledWith({
      settleTransition: true,
    });
  });

  test("resets confirmation after cancelling and reopening the dialog", async () => {
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
          m.accountDeletionConfirmLabel({}, { locale: "en-US" })
        )
      );
    });
    expect(
      (
        view.getByRole("button", {
          name: m.accountDeletionConfirm({}, { locale: "en-US" }),
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);

    await act(async () => {
      fireEvent.click(
        view.getByRole("button", {
          name: m.accountDeletionCancel({}, { locale: "en-US" }),
        })
      );
    });
    await openDialog(view);
    expect(
      (
        view.getByRole("button", {
          name: m.accountDeletionConfirm({}, { locale: "en-US" }),
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
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
    expect(
      view.getByText(m.accountDeletionDescription({}, { locale: "en-US" }))
    ).toBeTruthy();

    await act(async () => {
      fireEvent.click(view.getByText("Delete permanently"));
    });
    expect(view.getByText("Permanently delete this account?")).toBeTruthy();
  });
});
