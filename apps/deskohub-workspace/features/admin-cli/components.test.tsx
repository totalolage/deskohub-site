import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import type { CliSessionIdType } from "@deskohub/workspace-admin-api";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("./actions", () => ({
  revokeCliSession: mock(),
}));

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

afterEach(() => {
  cleanup();
});

afterAll(() => {
  unregisterWorkspaceComponentTestEnv();
});

test("requires confirmation before exposing the CLI revoke submission", async () => {
  const { RevokeCliSession } = await import("./revoke-cli-session");
  const view = render(
    <RevokeCliSession
      clientName="Office Mac"
      revoked={false}
      sessionId={"019f70bd-0131-7f30-9f8a-48e768f00292" as CliSessionIdType}
    />
  );

  expect(view.queryByRole("dialog")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Revoke" }));

  expect(view.getByRole("dialog")).toBeTruthy();
  expect(
    view.getByRole("heading", { name: "Revoke CLI session?" })
  ).toBeTruthy();
  expect(view.getByText(/“Office Mac”/)).toBeTruthy();
  expect(view.getByRole("button", { name: "Revoke access" })).toBeTruthy();
});
