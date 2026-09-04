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

  test("labels the required and optional fields in both locales", async () => {
    const { ProfileForm } = await import("./profile-form");

    const en = render(
      <ProfileForm
        mode="edit"
        locale="en-US"
        email="ada@example.test"
        profile={editProfile}
      />
    );
    expect(en.getByLabelText("First name, required")).toBeTruthy();
    expect(en.getByLabelText("Last name, optional")).toBeTruthy();
    expect(en.getByLabelText("Phone, optional")).toBeTruthy();
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
    expect(cs.getByLabelText("Jméno, povinné")).toBeTruthy();
    expect(cs.getByLabelText("Příjmení, nepovinné")).toBeTruthy();
    expect(cs.getByLabelText("Telefon, nepovinný")).toBeTruthy();
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
    expect(email.hasAttribute("required")).toBe(false);
  });

  test("submits the profile without any email field for the completion mode", async () => {
    const { ProfileForm } = await import("./profile-form");

    const view = render(
      <ProfileForm mode="complete" locale="en-US" email="ada@example.test" />
    );
    fireEvent.change(view.getByLabelText("First name, required"), {
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

    const firstName = view.getByLabelText("First name, required");
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

    const phone = view.getByLabelText("Phone, optional") as HTMLInputElement;
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

    const phone = view.getByLabelText("Phone, optional");
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

    expect(
      view.getByLabelText("Company name, required for business billing")
    ).toBeTruthy();
    expect(view.getByLabelText("Company ID, optional")).toBeTruthy();
    expect(view.getByLabelText("VAT ID, optional")).toBeTruthy();
    expect(view.getByLabelText("Street and number, optional")).toBeTruthy();

    fireEvent.change(view.getByLabelText("Billing profile"), {
      target: { value: "personal" },
    });
    expect(
      view.container.querySelector("#account-profile-billing-company-name")
    ).toBeNull();
    expect(view.getByLabelText("City, optional")).toBeTruthy();
  });
});
