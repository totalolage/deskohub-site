import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
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

const adaAddress = testEmailAddress("ada");

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
  acknowledgeSignupReferralNotice: mock(() =>
    Promise.resolve({ data: { status: "acknowledged" } })
  ),
  deleteCustomerAccount,
}));

mock.module("@/features/account/analytics-identity", () => ({
  beginAnalyticsAccountTransition,
  completeAnalyticsAccountSignOut,
  refreshAnalyticsAccountIdentity,
}));

type AuthResponse = {
  readonly data?: unknown;
  readonly error: { readonly status?: number; readonly code?: string } | null;
};
const signInMagicLink = mock(
  (): Promise<AuthResponse> => Promise.resolve({ error: null })
);
const signInEmailOtp = mock(
  (_body: {
    readonly email: string;
    readonly otp: string;
    readonly callbackURL: string;
  }): Promise<AuthResponse> =>
    Promise.resolve({ data: { token: "synthetic" }, error: null })
);
mock.module("@/features/account/auth.client", () => ({
  authClient: {
    signIn: { magicLink: signInMagicLink, emailOtp: signInEmailOtp },
    signOut: () => Promise.resolve({ error: null }),
    getSession: () => Promise.resolve({ data: null, error: null }),
  },
}));

// Mirrors next-safe-action 8 as wrapped by useWorkspaceAction: a thrown
// (transport) failure settles as "hasErrored" with an empty result and fires
// both onError (with thrownError) and onTransportError, and reset() discards
// the outcome of an in-flight request.
mock.module("@/shared/utils/use-workspace-action", () => ({
  useWorkspaceAction: (
    action: (input: never) => Promise<unknown>,
    options?: {
      readonly onSuccess?: (args: { readonly data?: unknown }) => void;
      readonly onError?: (args: {
        readonly error: ActionResult & { readonly thrownError?: unknown };
      }) => void;
      readonly onTransportError?: (args: {
        readonly error: unknown;
        readonly input: never;
      }) => void;
    }
  ) => {
    const [result, setResult] = React.useState<ActionResult>({});
    const [status, setStatus] = React.useState<
      "idle" | "executing" | "hasSucceeded" | "hasErrored"
    >("idle");
    const requestId = React.useRef(0);
    return {
      result,
      status,
      isIdle: status === "idle",
      isExecuting: status === "executing",
      hasSucceeded: status === "hasSucceeded",
      hasErrored: status === "hasErrored",
      execute: (input: never) => {
        const thisRequestId = ++requestId.current;
        setStatus("executing");
        void action(input)
          .then((outcome) => {
            if (thisRequestId !== requestId.current) return;
            const result = (outcome ?? {}) as ActionResult;
            setResult(result);
            if (
              result.serverError !== undefined ||
              result.validationErrors !== undefined
            ) {
              setStatus("hasErrored");
              options?.onError?.({ error: result });
            } else {
              setStatus("hasSucceeded");
              options?.onSuccess?.({ data: result.data });
            }
          })
          .catch((error) => {
            options?.onTransportError?.({ error, input });
            if (thisRequestId !== requestId.current) return;
            setResult({});
            setStatus("hasErrored");
            options?.onError?.({ error: { thrownError: error } });
          });
      },
      reset: () => {
        requestId.current += 1;
        setResult({});
        setStatus("idle");
      },
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
    signInEmailOtp.mockClear();
    workspaceRouterRefresh.mockClear();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
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

  test("keeps the destructive confirmation disabled until the checkbox is checked", async () => {
    const { DeleteAccountCard } = await import("./delete-account-card");

    const view = render(
      <DeleteAccountCard
        email={adaAddress}
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
        email={adaAddress}
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
            email={adaAddress}
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
          email={adaAddress}
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
          email={adaAddress}
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
      ).className
    ).not.toContain("sr-only");

    await act(async () => {
      fireEvent.click(view.getByText("Confirm by email"));
    });

    expect(signInMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({
        email: adaAddress,
        callbackURL: "/en-US/auth/callback",
      })
    );
    expect(view.getByText(/a new link is on its way/)).toBeTruthy();
  });

  const requestStaleDeletion = async (view: ReturnType<typeof render>) => {
    deleteCustomerAccount.mockImplementationOnce(() =>
      Promise.resolve({ data: { status: "reauthentication-required" } })
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
      fireEvent.click(view.getByText("Delete permanently"));
    });
  };

  test("presents the passkey-era confirmation while passkeys are on, even without one", async () => {
    const { DeleteAccountCard } = await import("./delete-account-card");
    const view = render(
      <DeleteAccountCard
        email={adaAddress}
        locale="en-US"
        deletionPending={false}
        passkeys={{ confirmWithPasskey: undefined }}
      />
    );
    await requestStaleDeletion(view);

    expect(
      view.getByRole("heading", { name: "Sign in again to delete" })
    ).toBeTruthy();
    expect(
      view.getByText(m.accountDeletionReauthBody({}, { locale: "en-US" }))
        .className
    ).toContain("sr-only");
    expect(
      view.container.ownerDocument.querySelector("svg.lucide-shield-check")
    ).toBeTruthy();
    expect(
      view.queryByRole("button", {
        name: m.accountReauthPasskey({}, { locale: "en-US" }),
      })
    ).toBeNull();
    expect(
      view.getByRole("button", {
        name: m.accountReauthSendEmail({}, { locale: "en-US" }),
      }).id
    ).toBe("delete-account-reauth-send");
  });

  test("confirms with a passkey and returns to the final confirmation", async () => {
    const confirmWithPasskey = mock(() =>
      Promise.resolve("confirmed" as const)
    );
    const { DeleteAccountCard } = await import("./delete-account-card");
    const view = render(
      <DeleteAccountCard
        email={adaAddress}
        locale="en-US"
        deletionPending={false}
        passkeys={{ confirmWithPasskey }}
      />
    );
    await requestStaleDeletion(view);

    expect(
      view.getByText(
        m.accountDeletionReauthPasskeyBody({}, { locale: "en-US" })
      ).className
    ).toContain("sr-only");
    const passkey = view.getByRole("button", {
      name: m.accountReauthPasskey({}, { locale: "en-US" }),
    });
    expect(passkey.id).toBe("delete-account-reauth-passkey");
    await act(async () => {
      fireEvent.click(passkey);
    });

    expect(confirmWithPasskey).toHaveBeenCalledTimes(1);
    expect(
      view.getByText(m.accountDeletionConfirmTitle({}, { locale: "en-US" }))
    ).toBeTruthy();
  });

  test("re-authenticates with a typed code and returns to the final confirmation", async () => {
    deleteCustomerAccount.mockImplementationOnce(() =>
      Promise.resolve({ data: { status: "reauthentication-required" } })
    );
    signInMagicLink.mockImplementationOnce(() =>
      Promise.resolve({ data: { status: true, signInCode: true }, error: null })
    );
    signInEmailOtp.mockImplementationOnce(() =>
      Promise.resolve({
        data: null,
        error: { status: 400, code: "INVALID_OTP" },
      })
    );
    const originalReplace = window.location.replace;
    const navigations: string[] = [];
    window.location.replace = ((href: string) => {
      navigations.push(href);
    }) as typeof window.location.replace;
    const { DeleteAccountCard } = await import("./delete-account-card");

    const view = render(
      <DeleteAccountCard
        email={adaAddress}
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
    await act(async () => {
      fireEvent.click(view.getByText("Confirm by email"));
    });

    expect(
      view.getByText(m.accountDeletionReauthCodeTitle({}, { locale: "en-US" }))
    ).toBeTruthy();
    const codeInput = () =>
      view.getByLabelText(
        m.accountSignInCodeLabel({}, { locale: "en-US" })
      ) as HTMLInputElement;

    await act(async () => {
      // This file loads React before happy-dom, so typed changes never reach
      // React; the OTP paste handler updates the value directly.
      codeInput().focus();
      fireEvent.paste(codeInput(), {
        clipboardData: { getData: () => "000000" },
      });
    });
    expect(
      view.getByText(m.accountSignInCodeInvalid({}, { locale: "en-US" }))
    ).toBeTruthy();

    await act(async () => {
      // This file loads React before happy-dom, so typed changes never reach
      // React; the OTP paste handler updates the value directly.
      codeInput().focus();
      fireEvent.paste(codeInput(), {
        clipboardData: { getData: () => "482913" },
      });
    });

    expect(signInEmailOtp).toHaveBeenLastCalledWith({
      email: adaAddress,
      otp: "482913",
      callbackURL: "/en-US/auth/callback",
    });
    // Deletion still waits for an explicit click on the final confirmation.
    expect(view.getByText("Delete permanently")).toBeTruthy();
    expect(deleteCustomerAccount).toHaveBeenCalledTimes(1);
    expect(navigations).toEqual([]);

    await act(async () => {
      fireEvent.click(view.getByText("Delete permanently"));
    });
    expect(deleteCustomerAccount).toHaveBeenCalledTimes(2);
    window.location.replace = originalReplace;
  });

  test("falls back to the link-only confirmation when a new email has no code", async () => {
    deleteCustomerAccount.mockImplementationOnce(() =>
      Promise.resolve({ data: { status: "reauthentication-required" } })
    );
    signInMagicLink.mockImplementationOnce(() => {
      // Date the code email past the resend cooldown.
      const realNow = Date.now;
      Date.now = () => {
        Date.now = realNow;
        return realNow() - 61 * 1000;
      };
      return Promise.resolve({
        data: { status: true, signInCode: true },
        error: null,
      });
    });
    const { DeleteAccountCard } = await import("./delete-account-card");

    const view = render(
      <DeleteAccountCard
        email={adaAddress}
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
    await act(async () => {
      fireEvent.click(view.getByText("Confirm by email"));
    });
    const resend = view.getByText(
      m.accountSignInCodeResend({}, { locale: "en-US" })
    );
    expect(resend.closest("button")?.disabled).toBe(false);
    const liveRegionsBeforeFallback = [
      ...document.querySelectorAll("[aria-live]"),
    ];

    signInMagicLink.mockImplementationOnce(() =>
      Promise.resolve({
        data: { status: true, signInCode: false },
        error: null,
      })
    );
    await act(async () => {
      fireEvent.click(resend);
    });

    expect(signInMagicLink).toHaveBeenCalledTimes(2);
    expect(
      view.queryByLabelText(m.accountSignInCodeLabel({}, { locale: "en-US" }))
    ).toBeNull();
    const linkSent = view.getByText(
      m.accountDeletionReauthLinkSent({}, { locale: "en-US" })
    );
    // Screen readers announce changes to a region that was already mounted.
    const announcement = linkSent.closest("[aria-live]");
    expect(announcement).not.toBeNull();
    expect(liveRegionsBeforeFallback).toContain(announcement as Element);
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
          email={adaAddress}
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
      name: "Confirm by email",
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
          email={adaAddress}
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
      fireEvent.click(view.getByRole("button", { name: "Confirm by email" }));
    });

    expect(view.getByRole("alert").textContent).toBe(
      "We could not send the link. Please try again."
    );
    expect(
      (
        view.getByRole("button", {
          name: "Confirm by email",
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
          email={adaAddress}
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
      name: "Confirm by email",
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
          email={adaAddress}
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
        email={adaAddress}
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

  test("shows a retryable error and refreshes identity after a transport failure", async () => {
    deleteCustomerAccount.mockImplementationOnce(() =>
      Promise.reject(new Error("synthetic transport failure"))
    );
    const { DeleteAccountCard } = await import("./delete-account-card");

    const view = render(
      <DeleteAccountCard
        email={adaAddress}
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

    expect(
      view.getByText(m.accountDeletionRequestFailed({}, { locale: "en-US" }))
    ).toBeTruthy();
    expect(view.queryByText("synthetic transport failure")).toBeNull();
    expect(
      (
        view.getByRole("button", {
          name: m.accountDeletionConfirm({}, { locale: "en-US" }),
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
    expect(view.getByRole("dialog")).toBeTruthy();
    expect(beginAnalyticsAccountTransition).toHaveBeenCalledTimes(1);
    expect(completeAnalyticsAccountSignOut).not.toHaveBeenCalled();
    expect(refreshAnalyticsAccountIdentity).toHaveBeenCalledTimes(1);
    expect(refreshAnalyticsAccountIdentity).toHaveBeenCalledWith({
      settleTransition: true,
    });
  });

  test("ignores close requests while deletion is in flight and still redirects", async () => {
    let resolveDeletion!: (result: ActionResult) => void;
    const pendingDeletion = new Promise<ActionResult>((resolve) => {
      resolveDeletion = resolve;
    });
    deleteCustomerAccount.mockImplementationOnce(() => pendingDeletion);
    const { DeleteAccountCard } = await import("./delete-account-card");

    let assigned: string | null = null;
    const originalAssign = window.location.assign;
    window.location.assign = ((href: string) => {
      assigned = href;
    }) as typeof window.location.assign;

    try {
      const view = render(
        <DeleteAccountCard
          email={adaAddress}
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

      const cancel = view.getByRole("button", {
        name: m.accountDeletionCancel({}, { locale: "en-US" }),
      }) as HTMLButtonElement;
      expect(cancel.disabled).toBe(true);

      await act(async () => {
        fireEvent.keyDown(view.getByRole("dialog"), {
          key: "Escape",
          code: "Escape",
        });
      });
      expect(view.getByRole("dialog")).toBeTruthy();
      expect(workspaceRouterRefresh).not.toHaveBeenCalled();

      await act(async () => {
        resolveDeletion({ data: { status: "deleted" } });
        await pendingDeletion;
      });

      expect(completeAnalyticsAccountSignOut).toHaveBeenCalledTimes(1);
      expect(assigned).toBe("/en-US/account/deleted");
    } finally {
      window.location.assign = originalAssign;
    }
  });

  test("refreshes the page only when cancelling after a deletion attempt", async () => {
    deleteCustomerAccount.mockImplementationOnce(() =>
      Promise.resolve({ data: { status: "failed" } })
    );
    const { DeleteAccountCard } = await import("./delete-account-card");

    const view = render(
      <DeleteAccountCard
        email={adaAddress}
        locale="en-US"
        deletionPending={false}
      />
    );
    const cancelDialog = async () => {
      await act(async () => {
        fireEvent.click(
          view.getByRole("button", {
            name: m.accountDeletionCancel({}, { locale: "en-US" }),
          })
        );
      });
    };

    await openDialog(view);
    await cancelDialog();
    expect(workspaceRouterRefresh).not.toHaveBeenCalled();

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
    await cancelDialog();
    expect(workspaceRouterRefresh).toHaveBeenCalledTimes(1);
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
        email={adaAddress}
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
        email={adaAddress}
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
      <DeleteAccountCard email={adaAddress} locale="en-US" deletionPending />
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
