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
import React, { Activity } from "react";
import { workspaceRouterRefresh } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

type ProfileInput = { firstName?: string; lastName?: string; phone?: string };

type ActionResult = {
  data?: { status?: string };
  serverError?: string;
  validationErrors?: unknown;
};

const completeCustomerProfile = mock(() =>
  Promise.resolve({ data: { status: "completed" } })
);
const updateCustomerProfile = mock(() =>
  Promise.resolve({ data: { status: "updated" } })
);

mock.module("@/features/account/actions", () => ({
  completeCustomerProfile,
  updateCustomerProfile,
}));

// A faithful stand-in for next-safe-action's hook contract so the component
// behaves as it does in the browser.
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
          const serverError = (outcome as { serverError?: string })
            ?.serverError;
          const validationErrors = (outcome as { validationErrors?: unknown })
            ?.validationErrors;
          if (serverError || validationErrors) return;
          options?.onSuccess?.({
            data: (outcome as { data?: unknown })?.data,
          });
        });
      },
      reset: () => setResult({}),
    };
  },
}));

const editProfile = {
  firstName: "Ada",
  lastName: "Lovelace",
  phone: "+420601111222",
  billing: null,
};

describe("ProfileForm", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
    completeCustomerProfile.mockClear();
    updateCustomerProfile.mockClear();
    workspaceRouterRefresh.mockClear();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("labels the profile fields without required or optional suffixes", async () => {
    const { ProfileForm } = await import("./profile-form");

    const en = render(
      <ProfileForm
        mode="edit"
        locale="en-US"
        email="ada@example.test"
        profile={editProfile}
      />
    );
    expect(en.getByLabelText("First name")).toBeTruthy();
    expect(en.getByLabelText("Last name")).toBeTruthy();
    expect(en.getByLabelText("Phone")).toBeTruthy();
    expect(en.getByText("Billing details, optional")).toBeTruthy();
    en.unmount();

    const cs = render(
      <ProfileForm
        mode="edit"
        locale="cs-CZ"
        email="ada@example.test"
        profile={editProfile}
      />
    );
    expect(cs.getByLabelText("Jméno")).toBeTruthy();
    expect(cs.getByLabelText("Příjmení")).toBeTruthy();
    expect(cs.getByLabelText("Telefon")).toBeTruthy();
  });

  test("keeps the verified login email read-only", async () => {
    const { ProfileForm } = await import("./profile-form");

    const view = render(
      <ProfileForm
        mode="edit"
        locale="en-US"
        email="ada@example.test"
        profile={editProfile}
      />
    );
    const email = view.getByLabelText(
      "Verified login email"
    ) as HTMLInputElement;
    expect(email.value).toBe("ada@example.test");
    expect(email.readOnly).toBe(true);
    expect(email.getAttribute("aria-readonly")).toBe("true");
    expect(email.hasAttribute("required")).toBe(false);
    expect(
      view.queryByText(
        "To protect your reservation history, the login email cannot be changed."
      )
    ).toBeNull();
  });

  test("submits the profile without any email field for the completion mode", async () => {
    const { ProfileForm } = await import("./profile-form");

    const view = render(
      <ProfileForm mode="complete" locale="en-US" email="ada@example.test" />
    );
    fireEvent.change(view.getByLabelText("First name"), {
      target: { value: "Ada" },
    });

    await act(async () => {
      fireEvent.submit(view.container.querySelector("#account-profile-form")!);
    });

    expect(completeCustomerProfile).toHaveBeenCalledTimes(1);
    const input = completeCustomerProfile.mock.calls[0]![0] as ProfileInput;
    expect(input).toEqual({ firstName: "Ada" });
    expect(JSON.stringify(input)).not.toContain("email");
    expect(workspaceRouterRefresh).toHaveBeenCalledTimes(1);
    await view.findByText("Your customer profile was created and linked.");
  });

  test("keeps a deferred completion draft for the next update save", async () => {
    let resolveCompletion!: (result: ActionResult) => void;
    const pendingCompletion = new Promise<ActionResult>((resolve) => {
      resolveCompletion = resolve;
    });
    completeCustomerProfile.mockImplementationOnce(() => pendingCompletion);

    const { ProfileForm } = await import("./profile-form");
    const { UnsavedChangesProvider } = await import(
      "@/shared/components/unsaved-changes-guard"
    );
    const originalConfirm = window.confirm;
    const confirm = mock(() => false);
    window.location.href = "http://localhost/account";
    window.confirm = confirm;

    try {
      const view = render(
        <UnsavedChangesProvider>
          <ProfileForm
            mode="complete"
            locale="en-US"
            email="ada@example.test"
          />
        </UnsavedChangesProvider>
      );
      const firstName = view.getByLabelText("First name") as HTMLInputElement;
      const form = view.container.querySelector("#account-profile-form")!;

      await act(async () => {
        fireEvent.input(firstName, { target: { value: "Ada" } });
        fireEvent.submit(form);
      });
      expect(
        (view.container.querySelector("fieldset") as HTMLFieldSetElement)
          .disabled
      ).toBe(false);
      await act(async () => {
        fireEvent.input(firstName, { target: { value: "Grace" } });
      });

      await act(async () => {
        resolveCompletion({ data: { status: "completed" } });
        await pendingCompletion;
      });

      expect(firstName.value).toBe("Grace");
      expect(workspaceRouterRefresh).not.toHaveBeenCalled();
      const link = document.createElement("a");
      link.href = "/next";
      document.body.append(link);
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      link.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(confirm).toHaveBeenCalledWith(
        "You have unsaved profile changes. Leave this page?"
      );

      await act(async () => {
        fireEvent.submit(form);
      });

      expect(completeCustomerProfile).toHaveBeenCalledTimes(1);
      expect(updateCustomerProfile).toHaveBeenCalledTimes(1);
      expect(workspaceRouterRefresh).toHaveBeenCalledTimes(1);
    } finally {
      window.confirm = originalConfirm;
    }
  });

  test("disables the form during a delayed completion refresh", async () => {
    let refreshReleased = false;
    let releaseRefresh!: () => void;
    const refreshPromise = new Promise<void>((resolve) => {
      releaseRefresh = () => {
        refreshReleased = true;
        resolve();
      };
    });
    let requestRefresh!: () => void;
    workspaceRouterRefresh.mockImplementationOnce(() => requestRefresh());

    const { ProfileForm } = await import("./profile-form");
    const { UnsavedChangesProvider } = await import(
      "@/shared/components/unsaved-changes-guard"
    );

    function DelayedRefresh({ requested }: { readonly requested: boolean }) {
      if (requested && !refreshReleased) throw refreshPromise;
      return null;
    }

    function RefreshFixture() {
      const [requested, setRequested] = React.useState(false);
      requestRefresh = () => setRequested(true);
      return (
        <UnsavedChangesProvider>
          <React.Suspense fallback={<p>Waiting for refresh</p>}>
            <DelayedRefresh requested={requested} />
            <ProfileForm
              mode="complete"
              locale="en-US"
              email="ada@example.test"
            />
          </React.Suspense>
        </UnsavedChangesProvider>
      );
    }

    const view = render(<RefreshFixture />);
    const firstName = view.getByLabelText("First name") as HTMLInputElement;
    const form = view.container.querySelector(
      "#account-profile-form"
    ) as HTMLFormElement;

    await act(async () => {
      fireEvent.input(firstName, { target: { value: "Ada" } });
      fireEvent.submit(form);
    });

    const fieldset = view.container.querySelector("fieldset")!;
    const submitButton = view.container.querySelector(
      "#account-profile-submit"
    )!;
    expect(workspaceRouterRefresh).toHaveBeenCalledTimes(1);
    expect(form.getAttribute("aria-busy")).toBe("true");
    expect((fieldset as HTMLFieldSetElement).disabled).toBe(true);
    expect((submitButton as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      releaseRefresh();
      await refreshPromise;
    });

    expect((view.getByLabelText("First name") as HTMLInputElement).value).toBe(
      "Ada"
    );
    expect(form.getAttribute("aria-busy")).toBe("false");
    expect((fieldset as HTMLFieldSetElement).disabled).toBe(false);
    expect((submitButton as HTMLButtonElement).disabled).toBe(false);
  });

  test("keeps native required validation before executing", async () => {
    const { ProfileForm } = await import("./profile-form");

    const view = render(
      <ProfileForm mode="complete" locale="en-US" email="ada@example.test" />
    );
    const form = view.container.querySelector("#account-profile-form")!;
    expect(
      (view.getByLabelText("First name") as HTMLInputElement).required
    ).toBe(true);
    expect((form as HTMLFormElement).noValidate).toBe(false);

    await act(async () => {
      fireEvent.submit(form);
    });

    expect(completeCustomerProfile).not.toHaveBeenCalled();
  });

  test("keeps the update success feedback without refreshing the page", async () => {
    const { ProfileForm } = await import("./profile-form");

    const view = render(
      <ProfileForm
        mode="edit"
        locale="en-US"
        email="ada@example.test"
        profile={editProfile}
      />
    );

    await act(async () => {
      fireEvent.submit(view.container.querySelector("#account-profile-form")!);
    });

    expect(updateCustomerProfile).toHaveBeenCalledTimes(1);
    expect(workspaceRouterRefresh).not.toHaveBeenCalled();
    expect(view.getByText("Profile updated.")).toBeTruthy();
  });

  test("reports action failures in the polite live region", async () => {
    updateCustomerProfile.mockImplementationOnce(() =>
      Promise.resolve({
        serverError: "We could not update your profile. Please try again.",
      })
    );
    const { ProfileForm } = await import("./profile-form");

    const view = render(
      <ProfileForm
        mode="edit"
        locale="en-US"
        email="ada@example.test"
        profile={editProfile}
      />
    );
    const feedback = view.container.querySelector("#account-profile-feedback")!;
    expect(feedback.getAttribute("aria-live")).toBe("polite");

    await act(async () => {
      fireEvent.submit(view.container.querySelector("#account-profile-form")!);
    });

    expect(
      view.getByText("We could not update your profile. Please try again.")
    ).toBeTruthy();
    expect(workspaceRouterRefresh).not.toHaveBeenCalled();
  });

  test("associates the first-name validation error with the field", async () => {
    updateCustomerProfile.mockImplementationOnce(() =>
      Promise.resolve({
        validationErrors: {
          formErrors: [],
          fieldErrors: { firstName: ["Enter your first name."] },
        },
      })
    );
    const { ProfileForm } = await import("./profile-form");

    const view = render(
      <ProfileForm
        mode="edit"
        locale="en-US"
        email="ada@example.test"
        profile={editProfile}
      />
    );

    await act(async () => {
      fireEvent.submit(view.container.querySelector("#account-profile-form")!);
    });

    const firstName = view.getByLabelText("First name");
    expect(firstName.getAttribute("aria-invalid")).toBe("true");
    expect(firstName.getAttribute("aria-describedby")).toBe(
      "account-profile-first-name-error"
    );
    expect(view.getByText("Enter your first name.").id).toBe(
      "account-profile-first-name-error"
    );
  });

  test("renders the stored legacy phone so an unparseable value stays visible", async () => {
    const { ProfileForm } = await import("./profile-form");

    const view = render(
      <ProfileForm
        mode="edit"
        locale="en-US"
        email="ada@example.test"
        profile={{ ...editProfile, phone: "555-ALPHA" }}
      />
    );

    const phone = view.getByLabelText("Phone") as HTMLInputElement;
    expect(phone.value).toBe("555-ALPHA");
  });

  test("forces phone correction instead of saving when the phone fails validation", async () => {
    updateCustomerProfile.mockImplementationOnce(() =>
      Promise.resolve({
        validationErrors: {
          formErrors: [],
          fieldErrors: {
            phone: ["Enter a valid phone number or clear the field."],
          },
        },
      })
    );
    const { ProfileForm } = await import("./profile-form");

    const view = render(
      <ProfileForm
        mode="edit"
        locale="en-US"
        email="ada@example.test"
        profile={{ ...editProfile, phone: "555-ALPHA" }}
      />
    );

    await act(async () => {
      fireEvent.submit(view.container.querySelector("#account-profile-form")!);
    });

    const phone = view.getByLabelText("Phone");
    expect(phone.getAttribute("aria-invalid")).toBe("true");
    expect(phone.getAttribute("aria-describedby")).toBe(
      "account-profile-phone-error"
    );
    expect(
      view.getByText("Enter a valid phone number or clear the field.").id
    ).toBe("account-profile-phone-error");
    expect(workspaceRouterRefresh).not.toHaveBeenCalled();
  });

  test("shows the validation message when the action rejects the input shape", async () => {
    updateCustomerProfile.mockImplementationOnce(() =>
      Promise.resolve({
        validationErrors: { formErrors: [], fieldErrors: { firstName: [] } },
      })
    );
    const { ProfileForm } = await import("./profile-form");

    const view = render(
      <ProfileForm
        mode="edit"
        locale="en-US"
        email="ada@example.test"
        profile={editProfile}
      />
    );

    await act(async () => {
      fireEvent.submit(view.container.querySelector("#account-profile-form")!);
    });

    expect(
      view.getByText("Please review the highlighted fields and try again.")
    ).toBeTruthy();
  });

  test("keeps a later edit guarded when a deferred save succeeds", async () => {
    let resolveUpdate!: (result: ActionResult) => void;
    const pendingUpdate = new Promise<ActionResult>((resolve) => {
      resolveUpdate = resolve;
    });
    updateCustomerProfile.mockImplementationOnce(() => pendingUpdate);

    const { ProfileForm } = await import("./profile-form");
    const { UnsavedChangesProvider } = await import(
      "@/shared/components/unsaved-changes-guard"
    );
    const originalConfirm = window.confirm;
    const confirm = mock(() => false);
    window.location.href = "http://localhost/account";
    window.confirm = confirm;

    try {
      const view = render(
        <UnsavedChangesProvider>
          <ProfileForm
            mode="edit"
            locale="en-US"
            email="ada@example.test"
            profile={editProfile}
          />
        </UnsavedChangesProvider>
      );
      const firstName = view.getByLabelText("First name") as HTMLInputElement;

      await act(async () => {
        fireEvent.input(firstName, { target: { value: "Grace" } });
        fireEvent.submit(
          view.container.querySelector("#account-profile-form")!
        );
      });
      await act(async () => {
        fireEvent.input(firstName, { target: { value: "Augusta" } });
      });

      await act(async () => {
        resolveUpdate({ data: { status: "updated" } });
        await pendingUpdate;
      });

      expect(firstName.value).toBe("Augusta");
      const link = document.createElement("a");
      link.href = "/next";
      document.body.append(link);
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      link.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(confirm).toHaveBeenCalledWith(
        "You have unsaved profile changes. Leave this page?"
      );
    } finally {
      window.confirm = originalConfirm;
    }
  });

  test("preserves typed values and the guard after a rejected save", async () => {
    updateCustomerProfile.mockImplementationOnce(() =>
      Promise.resolve({
        serverError: "We could not update your profile. Please try again.",
      })
    );
    const { ProfileForm } = await import("./profile-form");
    const { UnsavedChangesProvider } = await import(
      "@/shared/components/unsaved-changes-guard"
    );
    const originalConfirm = window.confirm;
    const confirm = mock(() => false);
    window.location.href = "http://localhost/account";
    window.confirm = confirm;

    try {
      const view = render(
        <UnsavedChangesProvider>
          <ProfileForm
            mode="edit"
            locale="en-US"
            email="ada@example.test"
            profile={editProfile}
          />
        </UnsavedChangesProvider>
      );
      const firstName = view.getByLabelText("First name") as HTMLInputElement;
      const lastName = view.getByLabelText("Last name") as HTMLInputElement;

      await act(async () => {
        fireEvent.input(firstName, { target: { value: "Grace" } });
        fireEvent.input(lastName, { target: { value: "Byron" } });
        fireEvent.submit(
          view.container.querySelector("#account-profile-form")!
        );
      });

      expect(firstName.value).toBe("Grace");
      expect(lastName.value).toBe("Byron");
      expect(
        view.getByText("We could not update your profile. Please try again.")
      ).toBeTruthy();

      const link = document.createElement("a");
      link.href = "/next";
      document.body.append(link);
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      link.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(confirm).toHaveBeenCalledWith(
        "You have unsaved profile changes. Leave this page?"
      );
    } finally {
      window.confirm = originalConfirm;
    }
  });

  test("preserves typed values and the guard after validation errors", async () => {
    updateCustomerProfile.mockImplementationOnce(() =>
      Promise.resolve({
        validationErrors: {
          formErrors: [],
          fieldErrors: { firstName: ["Enter your first name."] },
        },
      })
    );
    const { ProfileForm } = await import("./profile-form");
    const { UnsavedChangesProvider } = await import(
      "@/shared/components/unsaved-changes-guard"
    );
    const originalConfirm = window.confirm;
    const confirm = mock(() => false);
    window.location.href = "http://localhost/account";
    window.confirm = confirm;

    try {
      const view = render(
        <UnsavedChangesProvider>
          <ProfileForm
            mode="edit"
            locale="en-US"
            email="ada@example.test"
            profile={editProfile}
          />
        </UnsavedChangesProvider>
      );
      const firstName = view.getByLabelText("First name") as HTMLInputElement;

      await act(async () => {
        fireEvent.input(firstName, { target: { value: "Grace" } });
        fireEvent.submit(
          view.container.querySelector("#account-profile-form")!
        );
      });

      expect(firstName.value).toBe("Grace");
      expect(firstName.getAttribute("aria-invalid")).toBe("true");
      expect(
        view.getByText("Please review the highlighted fields and try again.")
      ).toBeTruthy();

      const link = document.createElement("a");
      link.href = "/next";
      document.body.append(link);
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      link.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(confirm).toHaveBeenCalledWith(
        "You have unsaved profile changes. Leave this page?"
      );
    } finally {
      window.confirm = originalConfirm;
    }
  });

  test("clears the guard after a successful save without extra edits", async () => {
    const { ProfileForm } = await import("./profile-form");
    const { UnsavedChangesProvider } = await import(
      "@/shared/components/unsaved-changes-guard"
    );
    const originalConfirm = window.confirm;
    const confirm = mock(() => false);
    window.location.href = "http://localhost/account";
    window.confirm = confirm;

    try {
      const view = render(
        <UnsavedChangesProvider>
          <ProfileForm
            mode="edit"
            locale="en-US"
            email="ada@example.test"
            profile={editProfile}
          />
        </UnsavedChangesProvider>
      );
      const firstName = view.getByLabelText("First name") as HTMLInputElement;

      await act(async () => {
        fireEvent.input(firstName, { target: { value: "Grace" } });
        const form = view.container.querySelector("#account-profile-form")!;
        fireEvent.submit(form);
        fireEvent.submit(form);
      });

      expect(updateCustomerProfile).toHaveBeenCalledTimes(1);
      const link = document.createElement("a");
      link.href = "/next";
      link.addEventListener("click", (event) => event.preventDefault());
      document.body.append(link);
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      link.dispatchEvent(event);

      expect(event.cancelBubble).toBe(false);
      expect(confirm).not.toHaveBeenCalled();
    } finally {
      window.confirm = originalConfirm;
    }
  });

  test("clears the guard when a changed value returns to its original value", async () => {
    const { ProfileForm } = await import("./profile-form");
    const { UnsavedChangesProvider } = await import(
      "@/shared/components/unsaved-changes-guard"
    );
    const originalConfirm = window.confirm;
    const confirm = mock(() => false);
    window.location.href = "http://localhost/account";
    window.confirm = confirm;

    try {
      const view = render(
        <UnsavedChangesProvider>
          <ProfileForm
            mode="edit"
            locale="en-US"
            email="ada@example.test"
            profile={editProfile}
          />
        </UnsavedChangesProvider>
      );
      const firstName = view.getByLabelText("First name") as HTMLInputElement;

      await act(async () => {
        fireEvent.input(firstName, { target: { value: "Grace" } });
        fireEvent.input(firstName, { target: { value: "Ada" } });
      });

      const link = document.createElement("a");
      link.href = "/next";
      link.addEventListener("click", (event) => event.preventDefault());
      document.body.append(link);
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      link.dispatchEvent(event);

      expect(event.cancelBubble).toBe(false);
      expect(confirm).not.toHaveBeenCalled();
    } finally {
      window.confirm = originalConfirm;
    }
  });

  test("preserves the original baseline across Activity hide and show", async () => {
    const { ProfileForm } = await import("./profile-form");
    const { UnsavedChangesProvider } = await import(
      "@/shared/components/unsaved-changes-guard"
    );
    const originalConfirm = window.confirm;
    const confirm = mock(() => false);
    window.location.href = "http://localhost/account";
    window.confirm = confirm;

    try {
      function ActivityHarness() {
        const [mode, setMode] = React.useState<"visible" | "hidden">("visible");
        return (
          <UnsavedChangesProvider>
            <button
              type="button"
              onClick={() =>
                setMode((currentMode) =>
                  currentMode === "visible" ? "hidden" : "visible"
                )
              }
            >
              Toggle activity
            </button>
            <Activity mode={mode}>
              <ProfileForm
                mode="edit"
                locale="en-US"
                email="ada@example.test"
                profile={editProfile}
              />
            </Activity>
          </UnsavedChangesProvider>
        );
      }

      const view = render(<ActivityHarness />);
      const firstName = view.getByLabelText("First name") as HTMLInputElement;
      const toggle = view.getByRole("button", { name: "Toggle activity" });

      await act(async () => {
        fireEvent.input(firstName, { target: { value: "Grace" } });
      });
      await act(async () => {
        fireEvent.click(toggle);
      });
      await act(async () => {
        fireEvent.click(toggle);
      });

      expect(
        (view.getByLabelText("First name") as HTMLInputElement).value
      ).toBe("Grace");
      await act(async () => {
        fireEvent.input(view.getByLabelText("First name"), {
          target: { value: "Ada" },
        });
      });

      const link = document.createElement("a");
      link.href = "/next";
      link.addEventListener("click", (event) => event.preventDefault());
      document.body.append(link);
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      link.dispatchEvent(event);

      expect(event.cancelBubble).toBe(false);
      expect(confirm).not.toHaveBeenCalled();
    } finally {
      window.confirm = originalConfirm;
    }
  });

  test("reveals business billing fields only after choosing business billing", async () => {
    const { ProfileForm } = await import("./profile-form");

    const view = render(
      <ProfileForm
        mode="edit"
        locale="en-US"
        email="ada@example.test"
        profile={editProfile}
      />
    );
    expect(
      view.container.querySelector("#account-profile-billing-company-name")
    ).toBeNull();

    await act(async () => {
      fireEvent.change(view.getByLabelText("Billing profile"), {
        target: { value: "business" },
      });
    });

    expect(view.getByLabelText("Company name")).toBeTruthy();
    expect(view.getByLabelText("Company ID")).toBeTruthy();
    expect(view.getByLabelText("VAT ID")).toBeTruthy();
    expect(view.getByLabelText("Street and number")).toBeTruthy();

    fireEvent.change(view.getByLabelText("Billing profile"), {
      target: { value: "personal" },
    });
    expect(
      view.container.querySelector("#account-profile-billing-company-name")
    ).toBeNull();
    expect(view.getByLabelText("City")).toBeTruthy();
  });

  test("blocks internal navigation after changing the profile", async () => {
    const { ProfileForm } = await import("./profile-form");
    const { UnsavedChangesProvider } = await import(
      "@/shared/components/unsaved-changes-guard"
    );
    const originalConfirm = window.confirm;
    const confirm = mock(() => false);
    window.location.href = "http://localhost/account";
    window.confirm = confirm;

    try {
      const view = render(
        <UnsavedChangesProvider>
          <ProfileForm
            mode="edit"
            locale="en-US"
            email="ada@example.test"
            profile={editProfile}
          />
        </UnsavedChangesProvider>
      );
      await act(async () => {
        fireEvent.input(view.getByLabelText("First name"), {
          target: { value: "Grace" },
        });
        await Promise.resolve();
      });

      const link = document.createElement("a");
      link.href = "/next";
      link.textContent = "Next";
      document.body.append(link);
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      link.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(confirm).toHaveBeenCalledWith(
        "You have unsaved profile changes. Leave this page?"
      );
    } finally {
      window.confirm = originalConfirm;
    }
  });
});
