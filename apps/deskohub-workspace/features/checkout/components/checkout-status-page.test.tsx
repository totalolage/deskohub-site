import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { CheckoutStatusViewModel } from "@/features/checkout/backend/checkout-status.service";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { CheckoutStatusPage } from "./checkout-status-page";

const baseStatus = {
  orderId: "reservation-status-page",
  returnOutcome: "success",
  status: "fulfilled",
  paymentStatus: "paid",
  fulfillmentStatus: "fulfilled",
} satisfies CheckoutStatusViewModel;

describe("CheckoutStatusPage", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("renders reconstructed reservation summary rows", () => {
    const view = render(
      <CheckoutStatusPage
        locale="en-US"
        status={{
          ...baseStatus,
          summary: {
            tier: "profi",
            date: "2026-06-20",
            coffee: false,
            monitorOption: "2x27-qhd",
            price: { value: 55_000, exponent: 2, currency: "CZK" },
          },
        }}
      />
    );

    expect(view.getByText("Profi Workstation")).toBeDefined();
    expect(view.getByText("Saturday, June 20, 2026")).toBeDefined();
    expect(view.getByText("2x 27 QHD")).toBeDefined();
    expect(view.getByText("CZK 550")).toBeDefined();
    expect(
      view.queryByText("We will send the reservation details by email.")
    ).toBeNull();
    expect(
      view.container.querySelector("[class*='bg-aquamarine-green/10']")
    ).toBeNull();
  });

  test("renders fallback copy without a reconstructed summary", () => {
    const view = render(
      <CheckoutStatusPage locale="en-US" status={baseStatus} />
    );

    expect(
      view.getByText("We will send the reservation details by email.")
    ).toBeDefined();
  });

  test("renders not found without reservation summary copy", () => {
    const view = render(
      <CheckoutStatusPage
        locale="en-US"
        status={{
          orderId: "test-order",
          returnOutcome: "unknown",
          status: "not_found",
        }}
      />
    );

    expect(view.getByText("We could not find this order.")).toBeDefined();
    expect(view.queryByText("Reservation summary")).toBeNull();
    expect(
      view.queryByText("We will send the reservation details by email.")
    ).toBeNull();
  });

  test("renders assigned table map when available", () => {
    const view = render(
      <CheckoutStatusPage
        locale="en-US"
        status={{
          ...baseStatus,
          tableMap: {
            assignedTableId: "desk-1",
            roomName: "Main room",
            tables: [
              {
                _cloudId: "cloud-id",
                id: "desk-1",
                name: "Desk 1",
                locationName: "Main room",
                positionX: "0",
                positionY: "0",
              },
            ],
          },
        }}
      />
    );

    expect(view.getByText("Where to sit")).toBeDefined();
    expect(view.getByText("Room: Main room")).toBeDefined();
    expect(view.getByRole("img", { name: "Where to sit" })).toBeDefined();
    expect(view.container.querySelector("svg rect")).toBeDefined();
  });

  test("renders prefilled support contact link for failed fulfillment", () => {
    const view = render(
      <CheckoutStatusPage
        locale="en-US"
        status={{
          ...baseStatus,
          status: "fulfillment_failed",
          fulfillmentStatus: "failed",
          supportContactPrefill: {
            name: "Ada Lovelace",
            email: "ada@example.com",
            phone: "+420777777777",
          },
          summary: {
            tier: "basic",
            date: "2026-06-20",
            coffee: false,
            price: { value: 35_000, exponent: 2, currency: "CZK" },
          },
        }}
      />
    );

    const link = view.getByRole("link", {
      name: "Send support request",
    });
    const href = link.getAttribute("href");
    expect(href?.startsWith("/en-US/contact?")).toBe(true);

    const contactUrl = new URL(href ?? "", "https://deskohub.local");
    expect(contactUrl.searchParams.get("name")).toBe("Ada Lovelace");
    expect(contactUrl.searchParams.get("email")).toBe("ada@example.com");
    expect(contactUrl.searchParams.get("phone")).toBe("+420777777777");
    expect(contactUrl.searchParams.get("message")).toBe(
      [
        "Hi Deskohub Workspace,",
        "",
        "My payment was received, but the access-code email did not arrive.",
        "",
        "Order reference: reservation-status-page",
        "Reservation: Basic Day Pass on Saturday, June 20, 2026",
        "",
        "Please help me get my workspace access codes.",
      ].join("\n")
    );
  });
});
