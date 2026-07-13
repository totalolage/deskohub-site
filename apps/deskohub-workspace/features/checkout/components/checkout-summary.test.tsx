import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { buildWorkspaceCheckoutQuote } from "@/features/checkout/checkout-quote-v2";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { CheckoutSummary } from "./checkout-summary";

const coworkReservationInterval = {
  startsAt: "2099-06-09T22:00:00Z",
  endsAt: "2099-06-10T22:00:00Z",
} as const;

describe("CheckoutSummary", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("renders server-provided summary rows and amounts without a duplicate title", () => {
    const quote = buildWorkspaceCheckoutQuote({
      ...coworkReservationInterval,
      kind: "cowork",
      tier: "basic",
      coffee: true,
    });

    const view = render(
      <CheckoutSummary locale="en-US" summary={quote.summary} />
    );

    expect(view.queryByText("Order summary")).toBeNull();
    expect(view.getByText("Basic Day Pass")).toBeDefined();
    expect(view.getByText("Coffee")).toBeDefined();
    expect(view.getAllByText(/CZK/).length).toBeGreaterThan(0);
  });

  test("localizes product summary item keys", () => {
    const quote = buildWorkspaceCheckoutQuote({
      ...coworkReservationInterval,
      kind: "cowork",
      tier: "basic",
      coffee: false,
    });

    const view = render(
      <CheckoutSummary locale="cs-CZ" summary={quote.summary} />
    );

    expect(view.getByText("Basic Day Pass")).toBeDefined();
    expect(view.queryByText("product:basic")).toBeNull();
  });

  test("localizes meeting room duration item keys", () => {
    const quote = buildWorkspaceCheckoutQuote({
      kind: "meeting-room",
      coffee: false,
      startsAt: "2099-06-10T09:00",
      endsAt: "2099-06-10T13:00",
    });

    const view = render(
      <CheckoutSummary locale="en-US" summary={quote.summary} />
    );

    expect(view.getByText("Meeting room - 4 hours")).toBeDefined();
    expect(view.queryByText("product:meeting-room:240")).toBeNull();
  });
});
