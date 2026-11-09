import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, render, within } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await unregisterWorkspaceComponentTestEnv();
});

describe("ConfirmDialog", () => {
  test("keeps the alert region mounted and announces a failure inside it", async () => {
    const { ConfirmDialog } = await import("./confirm-dialog");
    const renderDialog = (error: string | null) => (
      <ConfirmDialog
        confirmLabel="Delete draft"
        description="This permanently removes the draft."
        error={error}
        onConfirm={() => undefined}
        onOpenChange={() => undefined}
        open={true}
        pending={false}
        title="Delete this draft?"
        trigger={<button type="button">Delete draft</button>}
      />
    );
    const view = render(renderDialog(null));
    const dialog = within(view.getByRole("dialog"));
    const alert = dialog.getByRole("alert");
    expect(alert.textContent).toBe("");

    view.rerender(renderDialog("Only draft campaigns can be deleted."));

    expect(dialog.getByRole("alert")).toBe(alert);
    expect(alert.textContent).toBe("Only draft campaigns can be deleted.");
  });
});
