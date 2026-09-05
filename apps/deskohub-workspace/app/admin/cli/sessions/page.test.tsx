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
  AdministrationActorUsername,
  CliSessionId,
} from "@deskohub/workspace-admin-api";
import { cleanup, render } from "@testing-library/react";
import type { CliSessionAdministrationItem } from "@/features/admin-cli/cli-authentication.service";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("server-only", () => ({}));
mock.module("@/features/admin-cli/actions", () => ({
  approveCliAuthentication: mock(),
  renameCliSession: mock(),
  revokeCliSession: mock(),
}));
mock.module("@/features/admin-cli/rename-cli-session", () => ({
  RenameCliSession: () => null,
}));
mock.module("@/features/admin-cli/revoke-cli-session", () => ({
  RevokeCliSession: () => null,
}));

const sessionFixture = (
  overrides: Partial<CliSessionAdministrationItem>
): CliSessionAdministrationItem => ({
  id: CliSessionId.make("019f70bd-0131-7f30-9f8a-48e768f00292"),
  approvedBy: AdministrationActorUsername.make("operator"),
  clientName: "Office Mac",
  cliVersion: "1.2.0",
  buildTarget: "development",
  createdAt: "2026-09-01T10:00:00.000Z",
  lastUsedAt: "2026-09-01T10:05:00.000Z",
  revokedAt: null,
  ...overrides,
});

let sessionsData: {
  readonly username: string;
  readonly sessions: ReadonlyArray<CliSessionAdministrationItem>;
} = { username: "operator", sessions: [] };

mock.module("@/features/admin-cli/page-data.server", () => ({
  loadCliSessions: () => Promise.resolve(sessionsData),
}));

describe("CliSessionsPage", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => {
    cleanup();
    sessionsData = { username: "operator", sessions: [] };
  });
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("identifies the current administrator beside the session count", async () => {
    sessionsData = {
      username: "operator",
      sessions: [sessionFixture({})],
    };
    const { CliSessionsContent } = await import("./page");
    const view = render(
      await CliSessionsContent({ searchParams: Promise.resolve({}) })
    );

    const approvedBy = view.getByText(/Sessions approved by/);
    expect(approvedBy.textContent).toContain("Sessions approved by");
    expect(approvedBy.textContent).toContain("operator");
    expect(view.getByLabelText("1 CLI session").textContent).toBe("1");
  });

  test("keeps the administrator identity and accessible count in the empty state", async () => {
    const { CliSessionsContent } = await import("./page");
    const view = render(
      await CliSessionsContent({ searchParams: Promise.resolve({}) })
    );

    const approvedBy = view.getByText(/Sessions approved by/);
    expect(approvedBy.textContent).toContain("Sessions approved by");
    expect(approvedBy.textContent).toContain("operator");
    expect(view.getByLabelText("0 CLI sessions").textContent).toBe("0");
    expect(view.getByText(/No CLI sessions yet/)).toBeTruthy();
    expect(view.queryByRole("table", { name: "CLI sessions" })).toBeNull();
  });
});
