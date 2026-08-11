import "@/shared/polyfills/temporal";

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { CheckoutStatusViewModel } from "@/features/checkout/backend/checkout";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { CheckoutStatusPage } from "./checkout-status-page";
import { CheckoutStatusPageSkeleton } from "./checkout-status-page-skeleton";

const baseStatus: CheckoutStatusViewModel = {
  kind: "cowork",
  orderId: "reservation-status-page",
  returnOutcome: "success",
  status: "fulfilled",
  paymentStatus: "paid",
  fulfillmentStatus: "fulfilled",
};

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

  test("exposes an accessible busy status shell", () => {
    const view = render(<CheckoutStatusPageSkeleton locale="en-US" />);

    expect(
      view
        .getByRole("status", {
          name: "Payment status | Deskohub Workspace",
        })
        .getAttribute("aria-busy")
    ).toBe("true");
  });

  test("renders reconstructed reservation summary rows", () => {
    const view = render(
      <CheckoutStatusPage
        locale="en-US"
        status={{
          ...baseStatus,
          kind: "cowork",
          summary: {
            kind: "cowork",
            entryTier: "profi",
            coffee: true,
            monitorOption: "2x27-qhd",
            reservedFrom: Temporal.Instant.from("2026-06-19T22:00:00.000Z"),
            reservedUntil: Temporal.Instant.from("2026-06-20T22:00:00.000Z"),
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

  test("renders meeting-room timing and links to its current entry point", () => {
    const view = render(
      <CheckoutStatusPage
        locale="en-US"
        status={{
          ...baseStatus,
          kind: "meeting-room",
          summary: {
            kind: "meeting-room",
            reservedFrom: Temporal.Instant.from("2026-06-20T07:00:00.000Z"),
            reservedUntil: Temporal.Instant.from("2026-06-20T11:00:00.000Z"),
            price: { value: 155_000, exponent: 2, currency: "CZK" },
          },
        }}
      />
    );

    expect(view.getByText("Meeting Room")).toBeDefined();
    expect(view.getByText("Saturday, June 20, 2026")).toBeDefined();
    expect(view.getByText(/9:00 AM.*1:00 PM/)).toBeDefined();
    expect(view.getByText("CZK 1,550")).toBeDefined();
    expect(
      view
        .getByRole("link", { name: "Start a new reservation" })
        .getAttribute("href")
    ).toBe("/en-US/reservation/meeting-room");
  });

  test("presents midnight-to-midnight meeting-room reservations as whole day", () => {
    const view = render(
      <CheckoutStatusPage
        locale="en-US"
        status={{
          ...baseStatus,
          kind: "meeting-room",
          summary: {
            kind: "meeting-room",
            reservedFrom: Temporal.Instant.from("2026-03-28T23:00:00Z"),
            reservedUntil: Temporal.Instant.from("2026-03-29T22:00:00Z"),
            price: { value: 232_000, exponent: 2, currency: "CZK" },
          },
        }}
      />
    );

    expect(view.getByText("whole day")).toBeDefined();
    expect(view.queryByText(/12:00 AM/)).toBeNull();
    expect(view.getByText("CZK 2,320")).toBeDefined();
  });

  test("renders office dates and seats and links to its entry point", () => {
    const view = render(
      <CheckoutStatusPage
        locale="en-US"
        status={{
          ...baseStatus,
          kind: "office",
          summary: {
            kind: "office",
            reservedFrom: Temporal.Instant.from("2026-06-11T22:00:00Z"),
            reservedUntil: Temporal.Instant.from("2026-06-14T22:00:00Z"),
            seats: 3,
            price: { value: 442_500, exponent: 2, currency: "CZK" },
          },
        }}
      />
    );

    expect(view.getByText("Private office")).toBeDefined();
    expect(
      view.getByText("Friday, June 12 – Sunday, June 14, 2026")
    ).toBeDefined();
    expect(view.getByText("Seats").parentElement?.textContent).toBe("Seats3");
    expect(view.getByText("CZK 4,425")).toBeDefined();
    expect(
      view
        .getByRole("link", { name: "Start a new reservation" })
        .getAttribute("href")
    ).toBe("/en-US/reservation/office");
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
          kind: "cowork",
          status: "fulfillment_failed",
          fulfillmentStatus: "failed",
          supportContactPrefill: {
            name: "Ada Lovelace",
            email: "ada@example.com",
            phone: "+420777777777",
          },
          summary: {
            kind: "cowork",
            entryTier: "basic",
            coffee: false,
            reservedFrom: Temporal.Instant.from("2026-06-19T22:00:00.000Z"),
            reservedUntil: Temporal.Instant.from("2026-06-20T22:00:00.000Z"),
            price: { value: 35_000, exponent: 2, currency: "CZK" },
          },
        }}
      />
    );

    const link = view.getByRole("link", {
      name: "Send support request",
    });
    expect(link.id).toBe("checkout-status-support-contact");
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
