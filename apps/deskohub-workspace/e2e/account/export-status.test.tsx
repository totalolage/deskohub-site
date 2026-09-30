import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { buildZipArchive } from "@/shared/backend/utils/zip-archive";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import {
  accountDataExportActionMessage,
  accountDataExportDeliveredStatusMessage,
} from "./export-status";

beforeAll(registerWorkspaceComponentTestEnv);
afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

test("the lane's delivered-state expectation matches the rendered component output", async () => {
  const { AccountDataExport } = await import(
    "@/features/account/components/legal/account-data-export"
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(
        Buffer.from(
          buildZipArchive([
            {
              path: "manifest.json",
              content: JSON.stringify({ schemaVersion: 2 }),
            },
            { path: "identity.json", content: "{}" },
          ])
        ),
        {
          headers: {
            "Content-Type": "application/zip",
            "Content-Disposition":
              'attachment; filename="deskohub-account-data-2026-09-27.zip"',
          },
        }
      )
    );
  try {
    const view = render(<AccountDataExport locale="en-US" />);
    fireEvent.click(
      view.getByRole("button", { name: accountDataExportActionMessage() })
    );
    await waitFor(() =>
      expect(view.getByRole("status").textContent).toBe(
        accountDataExportDeliveredStatusMessage()
      )
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
