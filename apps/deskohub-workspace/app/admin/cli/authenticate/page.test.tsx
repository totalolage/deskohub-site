import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("server-only", () => ({}));
mock.module("@/features/admin-cli/actions", () => ({
  approveCliAuthentication: mock(),
}));

type CliApprovalRequestFixture = {
  readonly id: string;
  readonly clientName: string;
  readonly cliVersion: string;
  readonly buildTarget: "development";
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly state: "pending" | "approved" | "granted" | "expired" | "revoked";
};

const pendingRequest: CliApprovalRequestFixture = {
  id: "019f70bd-0131-7f30-9f8a-48e768f00292",
  clientName: "Office Mac",
  cliVersion: "1.2.0",
  buildTarget: "development",
  createdAt: "2026-09-01T10:00:00.000Z",
  expiresAt: "2026-09-01T10:05:00.000Z",
  state: "pending",
};

let approval: {
  readonly username: string;
  readonly request: CliApprovalRequestFixture | null;
} | null = { username: "operator", request: pendingRequest };

mock.module("@/features/admin-cli/page-data.server", () => ({
  loadCliAuthenticationApproval: () => Promise.resolve(approval),
}));

describe("CliAuthenticationApprovalPage", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => {
    cleanup();
    approval = { username: "operator", request: pendingRequest };
  });
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("names the authenticated administrator while approval is pending", async () => {
    const { CliAuthenticationRequest } = await import("./page");
    const view = render(
      await CliAuthenticationRequest({
        searchParams: Promise.resolve({ code: "pending-code" }),
      })
    );

    expect(view.getByText(/Approving as/).textContent).toContain(
      "Approving as operator."
    );
    expect(view.getByText("operator")).toBeTruthy();
    expect(view.getByText("Office Mac")).toBeTruthy();
    expect(view.getByRole("button", { name: "Approve this CLI" })).toBeTruthy();
  });

  test("does not imply approval once the request reaches a terminal state", async () => {
    approval = {
      username: "operator",
      request: { ...pendingRequest, state: "granted" },
    };
    const { CliAuthenticationRequest } = await import("./page");
    const view = render(
      await CliAuthenticationRequest({
        searchParams: Promise.resolve({ code: "granted-code" }),
      })
    );

    expect(view.queryByText(/Approving as/)).toBeNull();
    expect(view.queryByText("operator")).toBeNull();
    expect(view.getByText("CLI authenticated")).toBeTruthy();
  });

  test("keeps the invalid-request message free of an approver identity", async () => {
    approval = null;
    const { CliAuthenticationRequest } = await import("./page");
    const view = render(
      await CliAuthenticationRequest({
        searchParams: Promise.resolve({ code: "unknown-code" }),
      })
    );

    expect(view.queryByText(/Approving as/)).toBeNull();
    expect(
      view.getByText("This authentication request is invalid or has expired")
    ).toBeTruthy();
  });
});
