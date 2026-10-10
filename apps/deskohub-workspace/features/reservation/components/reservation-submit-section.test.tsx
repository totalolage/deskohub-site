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
import { ReservationSubmitSection } from "./reservation-submit-section";

const baseProps = {
  disabled: false,
  isAvailabilityLoading: false,
  isPriceLoading: false,
  locale: "en-US",
  onRetryPrice: () => undefined,
  priceError: false,
  retryingPrice: false,
} as const;

describe("ReservationSubmitSection", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(cleanup);

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("announces a failed submission as an alert", () => {
    const view = render(
      <ReservationSubmitSection
        {...baseProps}
        submissionError="The reservation could not be created."
      />
    );

    expect(view.getByRole("alert").textContent).toBe(
      "The reservation could not be created."
    );
  });

  test("keeps the availability hint a polite status, not an alert", () => {
    const view = render(
      <ReservationSubmitSection
        {...baseProps}
        unavailableMessage="This date is fully booked."
      />
    );

    expect(view.queryByRole("alert")).toBeNull();
    expect(view.getByText("This date is fully booked.")).toBeDefined();
  });
});
