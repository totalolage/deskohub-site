import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { workspaceRouterRefresh } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { CustomerAccountPageState } from "../page-data.server";

const signInMagicLink = mock(() => Promise.resolve({ error: null }));
const getSession = mock(() => Promise.resolve({ data: null, error: null }));
mock.module("@/shared/utils/use-workspace-action", () => ({
  useWorkspaceAction: () => ({
    execute: () => undefined,
    isExecuting: false,
    result: {},
    reset: () => undefined,
  }),
}));

mock.module("@/features/account/actions", () => ({
  completeCustomerProfile: () =>
    Promise.resolve({ data: { status: "completed" } }),
  updateCustomerProfile: () => Promise.resolve({ data: { status: "updated" } }),
  deleteCustomerAccount: () => Promise.resolve({ data: { status: "deleted" } }),
}));
mock.module("@/features/account/auth.client", () => ({
  authClient: {
    signIn: { magicLink: signInMagicLink },
    signOut: () => Promise.resolve({ error: null }),
    getSession,
  },
}));

const linkedState = {
  kind: "linked",
  email: "ada@example.test",
  profile: {
    firstName: "Ada",
    lastName: "Lovelace",
    phone: null,
    billing: null,
  },
  history: {
    kind: "available",
    groups: { current: [], past: [], unavailable: [] },
  },
} as const;

describe("AccountPage states", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
    workspaceRouterRefresh.mockClear();
    getSession.mockClear();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  const renderState = async (state: CustomerAccountPageState) => {
    const { AccountPage } = await import("./account-page");
    return render(<AccountPage locale="en-US" state={state} />);
  };

  test("asks for profile completion with the read-only verified email", async () => {
    const view = await renderState({
      kind: "completion-required",
      email: "ada@example.test",
    });

    expect(view.getByText("Complete your profile")).toBeTruthy();
    const email = view.getByLabelText(
      "Verified login email"
    ) as HTMLInputElement;
    expect(email.value).toBe("ada@example.test");
    expect(email.readOnly).toBe(true);
    expect(view.getByLabelText("First name, required")).toBeTruthy();
  });

  test("renders the linked account with profile, reservations, sign out, and deletion", async () => {
    const view = await renderState(linkedState);

    expect(view.getByText("My Workspace")).toBeTruthy();
    expect(view.getByText("Reservations")).toBeTruthy();
    expect(view.getByText("Delete my account")).toBeTruthy();
    expect(view.getByText("Sign out")).toBeTruthy();
    expect(view.getByText("Save profile")).toBeTruthy();
  });

  test("renders the support state with the contact destination and no profile data", async () => {
    const view = await renderState({ kind: "support-required" });

    expect(view.getByText("We need to verify your profile")).toBeTruthy();
    const contact = view.getByRole("link", {
      name: "Contact us",
    }) as HTMLAnchorElement;
    expect(contact.getAttribute("href")).toBe("/en-US/contact");
    expect(view.queryByText("Save profile")).toBeNull();
    expect(view.queryByText("Reservations")).toBeNull();
  });

  test("renders the pending deletion state with retry and sign out", async () => {
    const view = await renderState({
      kind: "deletion-pending",
      email: "ada@example.test",
    });

    expect(view.getByText("Account deletion is pending")).toBeTruthy();
    expect(view.getByText("Delete permanently")).toBeTruthy();
    expect(view.getByText("Sign out")).toBeTruthy();
    expect(view.queryByText("Reservations")).toBeNull();
  });

  test("renders the unavailable state without any account data", async () => {
    const view = await renderState({ kind: "unavailable" });

    expect(
      view.getByText("Customer accounts are temporarily unavailable")
    ).toBeTruthy();
    expect(view.queryByText("My Workspace")).toBeNull();
  });

  test("asks the get-session route handler to roll the browser cookie once per authenticated view", async () => {
    await renderState(linkedState);
    expect(getSession).toHaveBeenCalledTimes(1);

    await renderState({ kind: "unavailable" });
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  test("swallows a failed get-session request instead of leaving an unhandled rejection", async () => {
    getSession.mockImplementationOnce(() =>
      Promise.reject(new Error("get-session unavailable"))
    );

    const view = await renderState(linkedState);
    await act(async () => {
      await Promise.resolve();
    });

    expect(view.container).toBeTruthy();
  });
});
