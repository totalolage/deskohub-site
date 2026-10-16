import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("next/navigation", () => ({
  useParams: () => ({ locale: "en-US" }),
}));

const { SentRecipientTable } = await import("./sent-recipient-table");

beforeAll(() => registerWorkspaceComponentTestEnv());
afterEach(() => cleanup());
afterAll(() => unregisterWorkspaceComponentTestEnv());

test("shows unconfirmed recipients and why skipped recipients weren't mailed", () => {
  const view = render(
    <SentRecipientTable
      recipients={[
        {
          dotyposCustomerId: "synthetic-unconfirmed",
          locale: "cs-CZ",
          status: "unconfirmed",
          skipReason: null,
          statusUpdatedAt: "2026-10-14T08:00:00Z",
        },
        {
          dotyposCustomerId: "synthetic-skipped",
          locale: "en-US",
          status: "skipped",
          skipReason: "consent-withdrawn",
          statusUpdatedAt: "2026-10-14T08:00:00Z",
        },
      ]}
    />
  );

  expect(view.getAllByText("Unconfirmed").length).toBeGreaterThan(0);
  expect(view.getAllByText("Skipped").length).toBeGreaterThan(0);
  expect(
    view.getAllByText(/Marketing consent withdrawn/).length
  ).toBeGreaterThan(0);
});
