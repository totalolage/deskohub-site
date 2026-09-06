import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { AccountLoading } from "./account-loading";

describe("AccountLoading", () => {
  beforeAll(registerWorkspaceComponentTestEnv);

  afterEach(cleanup);

  afterAll(unregisterWorkspaceComponentTestEnv);

  test("exposes a localized busy status without profile values", () => {
    const view = render(<AccountLoading locale="en-US" />);
    const status = view.getByRole("status", {
      name: "My account | Deskohub Workspace",
    });

    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(status.textContent).toBe("");
    expect(
      status.querySelectorAll('[data-slot="skeleton"]').length
    ).toBeGreaterThan(0);
  });
});
