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
import { cleanup, render, within } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { CliSessionAdministrationItem } from "./cli-authentication.service";

mock.module("./actions", () => ({
  renameCliSession: mock(),
  revokeCliSession: mock(),
}));
mock.module("./rename-cli-session", () => ({
  RenameCliSession: () => null,
}));
mock.module("./revoke-cli-session", () => ({
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

describe("CliSessionsTable", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => cleanup());
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("renders each session row's own approving administrator", async () => {
    const { CliSessionsTable } = await import("./cli-sessions-table");
    const view = render(
      <CliSessionsTable
        sessions={[
          sessionFixture({
            id: CliSessionId.make("019f70bd-0131-7f30-9f8a-48e768f00292"),
            approvedBy: AdministrationActorUsername.make("operator"),
            clientName: "Office Mac",
          }),
          sessionFixture({
            id: CliSessionId.make("019f70bd-0131-7f30-9f8a-48e768f00293"),
            approvedBy: AdministrationActorUsername.make("backup-admin"),
            clientName: "Travel laptop",
          }),
        ]}
      />
    );

    const table = view.getByRole("table", { name: "CLI sessions" });
    expect(
      within(table).getByRole("columnheader", { name: "Approved by" })
    ).toBeTruthy();
    expect(within(table).getByText("operator")).toBeTruthy();
    expect(within(table).getByText("backup-admin")).toBeTruthy();
  });

  test("falls back to Unavailable when a session has no recorded approver", async () => {
    const { CliSessionsTable } = await import("./cli-sessions-table");
    const view = render(
      <CliSessionsTable
        sessions={[
          sessionFixture({
            approvedBy: null,
          }),
        ]}
      />
    );

    const table = view.getByRole("table", { name: "CLI sessions" });
    expect(within(table).getByText("Unavailable")).toBeTruthy();
  });
});
