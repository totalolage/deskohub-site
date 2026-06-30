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
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("server-only", () => ({}));
mock.module("@/features/reservation/actions/submit-reservation", () => ({
  submitReservation: mock(),
}));

describe("CheckoutPayPageSkeleton", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("renders skeleton order details with a disabled submit button", async () => {
    const { CheckoutPayPageSkeleton } = await import("./checkout-pay-page");
    const view = render(<CheckoutPayPageSkeleton locale="en-US" />);
    const submitButton = view.getByRole("button") as HTMLButtonElement;

    expect(submitButton.disabled).toBe(true);
    expect(
      view.getByText(m.checkoutSummarySectionOrder({}, { locale: "en-US" }))
    ).toBeDefined();
    expect(
      view.container.querySelectorAll(
        "[data-slot='skeleton'][aria-hidden='true']"
      ).length
    ).toBeGreaterThan(0);
  });
});
