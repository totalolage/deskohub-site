import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import React, { Activity } from "react";
import type { CustomerProfileInput } from "@/features/account/contracts";
import { UnsavedChangesProvider } from "@/shared/components/unsaved-changes-guard";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();

type ActionResult = {
  readonly data?: { readonly status?: string };
  readonly serverError?: string;
  readonly validationErrors?: {
    readonly formErrors?: readonly string[];
    readonly fieldErrors?: Readonly<
      Record<string, readonly string[] | undefined>
    >;
  };
};

const routerRefresh = mock(() => undefined);
const completeCustomerProfile = mock(
  (): Promise<ActionResult> =>
    Promise.resolve({ data: { status: "completed" } })
);
const updateCustomerProfile = mock(
  (_input: CustomerProfileInput): Promise<ActionResult> =>
    Promise.resolve({ data: { status: "updated" } })
);

mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

mock.module("@/features/account/actions", () => ({
  completeCustomerProfile,
  updateCustomerProfile,
}));

const businessProfile = {
  firstName: "Ada",
  lastName: "Lovelace",
  phone: "+420601111222",
  billing: {
    kind: "business" as const,
    addressLine1: "Original Street 1",
    addressLine2: null,
    city: "Prague",
    zip: "11000",
    country: "CZ",
    companyName: "Original Company",
    companyId: "12345678",
    vatId: null,
  },
};

type Section = "profile" | "billing";
type ActivityMode = "visible" | "hidden";

function ProfileFixture({
  initialSection = "profile",
}: {
  readonly initialSection?: Section;
}) {
  const [section, setSection] = React.useState<Section>(initialSection);
  const [activityMode, setActivityMode] =
    React.useState<ActivityMode>("visible");

  return (
    <UnsavedChangesProvider>
      <button type="button" onClick={() => setSection("profile")}>
        Profile section
      </button>
      <button type="button" onClick={() => setSection("billing")}>
        Billing section
      </button>
      <button
        type="button"
        onClick={() =>
          setActivityMode((current) =>
            current === "visible" ? "hidden" : "visible"
          )
        }
      >
        Toggle activity
      </button>
      <output data-testid="active-section">{section}</output>
      <Activity mode={activityMode}>
        <ProfileFormForTest
          email="ada@example.test"
          locale="en-US"
          mode="edit"
          onSectionChange={setSection}
          profile={businessProfile}
          section={section}
        />
      </Activity>
    </UnsavedChangesProvider>
  );
}

function expectDirty() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
}

function expectClean() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
}

let ProfileFormForTest: typeof import("./profile-form").ProfileForm;

describe("ProfileForm action lifecycle", () => {
  beforeAll(async () => {
    ({ ProfileForm: ProfileFormForTest } = await import("./profile-form"));
  });

  afterEach(() => {
    cleanup();
    completeCustomerProfile.mockClear();
    updateCustomerProfile.mockClear();
    routerRefresh.mockClear();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("reveals profile after a billing save reports a phone error and retains drafts", async () => {
    let resolveUpdate!: (result: ActionResult) => void;
    const pendingUpdate = new Promise<ActionResult>((resolve) => {
      resolveUpdate = resolve;
    });
    updateCustomerProfile.mockImplementationOnce(() => pendingUpdate);

    const view = render(<ProfileFixture initialSection="billing" />);
    await act(async () => {
      fireEvent.input(view.getByLabelText("First name"), {
        target: { value: "Grace" },
      });
      fireEvent.input(view.getByLabelText("Last name"), {
        target: { value: "Byron" },
      });
      fireEvent.input(view.getByLabelText("Phone"), {
        target: { value: "+420602222333" },
      });
    });
    await act(async () => {
      fireEvent.input(view.getByLabelText("Company name"), {
        target: { value: "Draft Company" },
      });
      fireEvent.input(view.getByLabelText("Street and number"), {
        target: { value: "Draft Street 2" },
      });
      expect(
        (view.getByLabelText("Company name") as HTMLInputElement).value
      ).toBe("Draft Company");
      fireEvent.click(view.getByRole("button", { name: "Profile section" }));
      fireEvent.click(view.getByRole("button", { name: "Billing section" }));
      expect(
        (view.getByLabelText("Company name") as HTMLInputElement).value
      ).toBe("Draft Company");
      fireEvent.submit(view.container.querySelector("#account-profile-form")!);
    });

    await waitFor(() => expect(updateCustomerProfile).toHaveBeenCalledTimes(1));
    expect(view.getByTestId("active-section").textContent).toBe("billing");
    expect(updateCustomerProfile.mock.calls[0]?.[0]).toMatchObject({
      billing: { companyName: "Draft Company" },
    });

    await act(async () => {
      resolveUpdate({
        validationErrors: {
          formErrors: [],
          fieldErrors: {
            phone: ["Enter a valid phone number or clear the field."],
          },
        },
      });
      await pendingUpdate;
    });

    await waitFor(() =>
      expect(view.getByTestId("active-section").textContent).toBe("profile")
    );
    expect((view.getByLabelText("First name") as HTMLInputElement).value).toBe(
      "Grace"
    );
    const companyName = view.getByLabelText("Company name") as HTMLInputElement;
    expect(companyName.value).toBe("Draft Company");
    expect(view.getByLabelText("Phone").getAttribute("aria-invalid")).toBe(
      "true"
    );
    expect(
      view.getByText("Enter a valid phone number or clear the field.")
    ).toBeTruthy();
    expectDirty();
  });

  test("updates the profile display from the submitted identity and retains later drafts", async () => {
    let resolveUpdate!: (result: ActionResult) => void;
    const pendingUpdate = new Promise<ActionResult>((resolve) => {
      resolveUpdate = resolve;
    });
    updateCustomerProfile.mockImplementationOnce(() => pendingUpdate);

    const view = render(<ProfileFixture />);
    const profileScreen = () =>
      view.container.querySelector(
        "[data-slot='profile-screen']"
      ) as HTMLElement;
    const firstName = view.getByLabelText("First name") as HTMLInputElement;
    const lastName = view.getByLabelText("Last name") as HTMLInputElement;

    expect(within(profileScreen()).getByText("Ada Lovelace")).toBeTruthy();
    expect(
      profileScreen().querySelector("div[aria-hidden='true']")?.textContent
    ).toBe("AL");

    await act(async () => {
      fireEvent.input(firstName, { target: { value: "Ada" } });
      fireEvent.input(lastName, { target: { value: "Saved" } });
      fireEvent.submit(view.container.querySelector("#account-profile-form")!);
    });

    await waitFor(() => expect(updateCustomerProfile).toHaveBeenCalledTimes(1));
    expect(updateCustomerProfile.mock.calls[0]?.[0]).toMatchObject({
      firstName: "Ada",
      lastName: "Saved",
    });

    await act(async () => {
      fireEvent.input(firstName, { target: { value: "Later" } });
      fireEvent.input(lastName, { target: { value: "Draft" } });
      resolveUpdate({ data: { status: "updated" } });
      await pendingUpdate;
    });

    await waitFor(() =>
      expect(within(profileScreen()).getByText("Ada Saved")).toBeTruthy()
    );
    expect(within(profileScreen()).queryByText("Ada Lovelace")).toBeNull();
    expect(
      profileScreen().querySelector("div[aria-hidden='true']")?.textContent
    ).toBe("AS");
    expect(firstName.value).toBe("Later");
    expect(lastName.value).toBe("Draft");
    expect(routerRefresh).not.toHaveBeenCalled();
    expectDirty();
  });

  test("keeps the saved profile display identity when the edit save fails", async () => {
    let resolveUpdate!: (result: ActionResult) => void;
    const pendingUpdate = new Promise<ActionResult>((resolve) => {
      resolveUpdate = resolve;
    });
    updateCustomerProfile.mockImplementationOnce(() => pendingUpdate);

    const view = render(<ProfileFixture />);
    const profileScreen = () =>
      view.container.querySelector(
        "[data-slot='profile-screen']"
      ) as HTMLElement;
    const firstName = view.getByLabelText("First name") as HTMLInputElement;
    const lastName = view.getByLabelText("Last name") as HTMLInputElement;

    await act(async () => {
      fireEvent.input(firstName, { target: { value: "Changed" } });
      fireEvent.input(lastName, { target: { value: "Name" } });
      fireEvent.submit(view.container.querySelector("#account-profile-form")!);
    });
    await waitFor(() => expect(updateCustomerProfile).toHaveBeenCalledTimes(1));

    await act(async () => {
      resolveUpdate({
        serverError: "We could not update your profile. Please try again.",
      });
      await pendingUpdate;
    });

    await waitFor(() =>
      expect(
        within(profileScreen()).getByText(
          "We could not update your profile. Please try again."
        )
      ).toBeTruthy()
    );
    expect(within(profileScreen()).getByText("Ada Lovelace")).toBeTruthy();
    expect(within(profileScreen()).queryByText("Changed Name")).toBeNull();
    expect(
      profileScreen().querySelector("div[aria-hidden='true']")?.textContent
    ).toBe("AL");
    expect(firstName.value).toBe("Changed");
    expect(lastName.value).toBe("Name");
    expect(routerRefresh).not.toHaveBeenCalled();
    expectDirty();
  });

  test("reveals billing after a profile save reports a company error with feedback", async () => {
    updateCustomerProfile.mockImplementationOnce(() =>
      Promise.resolve({
        validationErrors: {
          formErrors: [],
          fieldErrors: {
            billing: ["companyName: Company name is required."],
          },
        },
      })
    );

    const view = render(<ProfileFixture initialSection="profile" />);
    await act(async () => {
      fireEvent.input(view.getByLabelText("First name"), {
        target: { value: "Grace" },
      });
      fireEvent.submit(view.container.querySelector("#account-profile-form")!);
    });

    await waitFor(() => expect(updateCustomerProfile).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(view.getByTestId("active-section").textContent).toBe("billing")
    );

    const companyName = view.getByLabelText("Company name");
    expect(companyName.getAttribute("aria-invalid")).toBe("true");
    expect(companyName.getAttribute("aria-describedby")).toBe(
      "account-profile-billing-company-name-error"
    );
    const companyNameError = view.container.querySelector(
      "#account-profile-billing-company-name-error"
    );
    expect(companyNameError?.textContent).toBe(
      "Please review the highlighted fields and try again."
    );
    expectDirty();
  });

  test("prioritizes profile when profile and billing errors arrive together", async () => {
    updateCustomerProfile.mockImplementationOnce(() =>
      Promise.resolve({
        validationErrors: {
          formErrors: [],
          fieldErrors: {
            firstName: ["Enter your first name."],
            billing: ["companyName: Company name is required."],
          },
        },
      })
    );

    const view = render(<ProfileFixture initialSection="billing" />);
    await act(async () => {
      fireEvent.submit(view.container.querySelector("#account-profile-form")!);
    });

    await waitFor(() => expect(updateCustomerProfile).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(view.getByTestId("active-section").textContent).toBe("profile")
    );
    expect(view.getByLabelText("First name").getAttribute("aria-invalid")).toBe(
      "true"
    );
  });

  test("preserves the full submitted baseline through late edits and Activity hide/show", async () => {
    let resolveUpdate!: (result: ActionResult) => void;
    const pendingUpdate = new Promise<ActionResult>((resolve) => {
      resolveUpdate = resolve;
    });
    updateCustomerProfile.mockImplementationOnce(() => pendingUpdate);

    const view = render(<ProfileFixture />);
    await act(async () => {
      fireEvent.input(view.getByLabelText("First name"), {
        target: { value: "Grace" },
      });
      fireEvent.input(view.getByLabelText("Last name"), {
        target: { value: "Byron" },
      });
      fireEvent.input(view.getByLabelText("Phone"), {
        target: { value: "+420602222333" },
      });
      fireEvent.click(view.getByRole("button", { name: "Billing section" }));
    });
    await act(async () => {
      fireEvent.input(view.getByLabelText("Company name"), {
        target: { value: "Draft Company" },
      });
      fireEvent.input(view.getByLabelText("Company ID"), {
        target: { value: "87654321" },
      });
      fireEvent.input(view.getByLabelText("Street and number"), {
        target: { value: "Draft Street 2" },
      });
      fireEvent.input(view.getByLabelText("City"), {
        target: { value: "Brno" },
      });
      expect(
        (view.getByLabelText("Company name") as HTMLInputElement).value
      ).toBe("Draft Company");
      fireEvent.submit(view.container.querySelector("#account-profile-form")!);
    });

    await waitFor(() => expect(updateCustomerProfile).toHaveBeenCalledTimes(1));
    expect(updateCustomerProfile.mock.calls[0]?.[0]).toEqual({
      firstName: "Grace",
      lastName: "Byron",
      phone: "+420602222333",
      billing: {
        kind: "business",
        companyName: "Draft Company",
        companyId: "87654321",
        vatId: undefined,
        addressLine1: "Draft Street 2",
        addressLine2: undefined,
        city: "Brno",
        zip: "11000",
        country: "CZ",
      },
    });

    await act(async () => {
      fireEvent.input(view.getByLabelText("Phone"), {
        target: { value: "+420603333444" },
      });
      fireEvent.input(view.getByLabelText("Company name"), {
        target: { value: "Late Company" },
      });
    });
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Toggle activity" }));
    });
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Toggle activity" }));
    });

    expect((view.getByLabelText("Phone") as HTMLInputElement).value).toBe(
      "+420603333444"
    );
    expect(
      (view.getByLabelText("Company name") as HTMLInputElement).value
    ).toBe("Late Company");

    await act(async () => {
      resolveUpdate({ data: { status: "updated" } });
      await pendingUpdate;
    });
    await waitFor(() =>
      expect(view.getByText("Profile updated.")).toBeTruthy()
    );

    expect((view.getByLabelText("Phone") as HTMLInputElement).value).toBe(
      "+420603333444"
    );
    expect(
      (view.getByLabelText("Company name") as HTMLInputElement).value
    ).toBe("Late Company");
    expect(routerRefresh).not.toHaveBeenCalled();
    expectDirty();

    await act(async () => {
      fireEvent.input(view.getByLabelText("Phone"), {
        target: { value: "+420602222333" },
      });
      fireEvent.input(view.getByLabelText("Company name"), {
        target: { value: "Draft Company" },
      });
    });
    expectClean();

    await act(async () => {
      fireEvent.input(view.getByLabelText("Company name"), {
        target: { value: "Later Company" },
      });
    });
    expectDirty();
  });

  test("derives native invalid section priority from the current first invalid field", async () => {
    const view = render(<ProfileFixture initialSection="billing" />);
    const form = view.container.querySelector(
      "#account-profile-form"
    ) as HTMLFormElement;
    const firstName = view.getByLabelText("First name") as HTMLInputElement;
    const lastName = view.getByLabelText("Last name") as HTMLInputElement;
    const phone = view.getByLabelText("Phone") as HTMLInputElement;
    const companyName = view.getByLabelText("Company name") as HTMLInputElement;
    const addressLine1 = view.getByLabelText(
      "Street and number"
    ) as HTMLInputElement;
    const panels = [...form.querySelectorAll<HTMLElement>("fieldset > div")];
    const profilePanel = panels[0];
    const billingPanel = panels[1];
    expect(profilePanel?.hidden).toBe(true);
    expect(billingPanel?.hidden).toBe(false);

    // happy-dom excludes controls under [hidden] from requestSubmit. Expose
    // the inactive panel so both attempts still use native invalid events.
    profilePanel!.hidden = false;

    await act(async () => {
      fireEvent.input(firstName, { target: { value: "" } });
      fireEvent.input(lastName, { target: { value: "Byron" } });
      fireEvent.input(phone, { target: { value: "+420602222333" } });
      fireEvent.input(companyName, { target: { value: "" } });
      fireEvent.input(addressLine1, { target: { value: "Draft Street 2" } });
      form.requestSubmit();
    });

    expect(view.getByTestId("active-section").textContent).toBe("profile");
    expect(updateCustomerProfile).not.toHaveBeenCalled();
    expect(firstName.value).toBe("");
    expect(lastName.value).toBe("Byron");
    expect(phone.value).toBe("+420602222333");
    expect(companyName.value).toBe("");
    expect(addressLine1.value).toBe("Draft Street 2");

    await act(async () => {
      fireEvent.input(firstName, { target: { value: "Grace" } });
      billingPanel!.hidden = false;
      form.requestSubmit();
    });

    expect(view.getByTestId("active-section").textContent).toBe("billing");
    expect(updateCustomerProfile).not.toHaveBeenCalled();
    expect(view.getByLabelText("First name")).toBe(firstName);
    expect(view.getByLabelText("Company name")).toBe(companyName);
    expect(firstName.value).toBe("Grace");
    expect(lastName.value).toBe("Byron");
    expect(phone.value).toBe("+420602222333");
    expect(companyName.value).toBe("");
    expect(addressLine1.value).toBe("Draft Street 2");
  });
});
