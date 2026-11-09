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
import { cleanup, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("server-only", () => ({}));
mock.module("@/features/i18n/server/request-locale", () => ({
  getRequestLocale: () => Promise.resolve("en-US"),
}));
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

const operatorEmail = testEmailAddress("cli-approval-operator");

let approval: {
  readonly administratorEmail: string;
  readonly request: CliApprovalRequestFixture | null;
} | null = { administratorEmail: operatorEmail, request: pendingRequest };

mock.module("@/features/admin-cli/page-data.server", () => ({
  loadCliAuthenticationApproval: () => Promise.resolve(approval),
}));

describe("CliAuthenticationRequest", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => {
    cleanup();
    approval = { administratorEmail: operatorEmail, request: pendingRequest };
  });
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("names the authenticated administrator while approval is pending", async () => {
    const { CliAuthenticationRequest } = await import(
      "./cli-authentication-screen"
    );
    const view = render(
      await CliAuthenticationRequest({
        locale: "en-US",
        searchParams: Promise.resolve({ code: "pending-code" }),
      })
    );

    expect(view.getByText(/Approving as/).textContent).toContain(
      `Approving as ${operatorEmail}.`
    );
    expect(view.getByText(operatorEmail).tagName).toBe("STRONG");
    expect(view.getByText("Office Mac")).toBeTruthy();
    expect(view.getByRole("button", { name: "Approve this CLI" })).toBeTruthy();
  });

  test("renders the pending approval in Czech on a Czech route", async () => {
    const { CliAuthenticationRequest } = await import(
      "./cli-authentication-screen"
    );
    const { RouteLocaleProvider } = await import(
      "@/features/i18n/route-locale"
    );
    const view = render(
      <RouteLocaleProvider locale="cs-CZ">
        {
          await CliAuthenticationRequest({
            locale: "cs-CZ",
            searchParams: Promise.resolve({ code: "pending-code" }),
          })
        }
      </RouteLocaleProvider>
    );

    expect(view.getByText(/Schvalujete jako/).textContent).toContain(
      `Schvalujete jako ${operatorEmail}.`
    );
    expect(view.getByText(operatorEmail).tagName).toBe("STRONG");
    expect(view.getByText("Klient")).toBeTruthy();
    expect(
      view.getByRole("button", { name: "Schválit toto CLI" })
    ).toBeTruthy();
  });

  test("does not imply approval once the request reaches a terminal state", async () => {
    approval = {
      administratorEmail: operatorEmail,
      request: { ...pendingRequest, state: "granted" },
    };
    const { CliAuthenticationRequest } = await import(
      "./cli-authentication-screen"
    );
    const view = render(
      await CliAuthenticationRequest({
        locale: "en-US",
        searchParams: Promise.resolve({ code: "granted-code" }),
      })
    );

    expect(view.queryByText(/Approving as/)).toBeNull();
    expect(view.queryByText(operatorEmail)).toBeNull();
    expect(view.getByText("CLI authenticated")).toBeTruthy();
  });
});
