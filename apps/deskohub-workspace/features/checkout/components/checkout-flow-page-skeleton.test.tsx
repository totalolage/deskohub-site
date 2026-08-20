import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { CheckoutFlowPageSkeleton } from "./checkout-flow-page-skeleton";

describe("CheckoutFlowPageSkeleton", () => {
  beforeAll(registerWorkspaceComponentTestEnv);
  afterAll(() => {
    cleanup();
    unregisterWorkspaceComponentTestEnv();
  });

  test("exposes an accessible loading state", () => {
    const view = render(
      <CheckoutFlowPageSkeleton label="Invoice" locale="en-US" />
    );

    expect(
      view.getByRole("status", { name: "Invoice" }).getAttribute("aria-busy")
    ).toBe("true");
  });
});
