import "@/shared/polyfills/temporal";

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import type { CheckoutStatusViewModel } from "@/features/checkout/backend/checkout";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { CheckoutStatusPageSkeleton } from "./checkout-status-page-skeleton";

type CapturedLink = {
  readonly href: string;
  readonly prefetch: boolean | null | undefined;
};

const capturedLinks: CapturedLink[] = [];

mock.module("next/link", () => ({
  default: ({
    children,
    href,
    prefetch,
    ...props
  }: Omit<ComponentProps<"a">, "href"> & {
    readonly children?: ReactNode;
    readonly href: string | URL;
    readonly prefetch?: boolean | null;
  }) => {
    const stringHref = href.toString();
    capturedLinks.push({ href: stringHref, prefetch });
    return (
      <a data-next-link="" href={stringHref} {...props}>
        {children}
      </a>
    );
  },
}));

const { CheckoutStatusPage } = await import("./checkout-status-page");

const baseStatus: CheckoutStatusViewModel = {
  kind: "cowork",
  orderId: "reservation-status-page",
  returnOutcome: "success",
  status: "fulfilled",
  paymentStatus: "paid",
  fulfillmentStatus: "fulfilled",
};

const reconstructedCoworkStatus: CheckoutStatusViewModel = {
  ...baseStatus,
  summary: {
    kind: "cowork",
    entryTier: "profi",
    coffee: true,
    monitorOption: "2x27-qhd",
    reservedFrom: Temporal.Instant.from("2026-06-19T22:00:00.000Z"),
    reservedUntil: Temporal.Instant.from("2026-06-20T22:00:00.000Z"),
    price: { value: 55_000, exponent: 2, currency: "CZK" },
  },
};

describe("CheckoutStatusPage", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  beforeEach(() => {
    capturedLinks.length = 0;
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

  test("exposes an accessible plain modal busy status shell", () => {
    const view = render(
      <CheckoutStatusPageSkeleton locale="en-US" presentation="modal" />
    );
    const status = view.getByRole("status", {
      name: "Payment status | Deskohub Workspace",
    });

    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(status.getAttribute("class")).toBe(
      "block bg-white p-6 text-navy-blue sm:p-10"
    );
  });

  test("keeps the canonical default skeleton equivalent to explicit page markup", () => {
    const defaultView = render(<CheckoutStatusPageSkeleton locale="en-US" />);
    const defaultMarkup = defaultView.container.innerHTML;
    cleanup();

    const explicitPageView = render(
      <CheckoutStatusPageSkeleton locale="en-US" presentation="page" />
    );

    expect(explicitPageView.container.innerHTML).toBe(defaultMarkup);
  });

  test("renders reconstructed reservation summary rows", () => {
    const view = render(
      <CheckoutStatusPage locale="en-US" status={reconstructedCoworkStatus} />
    );

    expect(view.getByText("Profi Workstation")).toBeDefined();
    expect(view.getByText("Saturday, June 20, 2026")).toBeDefined();
    expect(view.getByText("2x 27 QHD")).toBeDefined();
    expect(view.getByText("CZK 550")).toBeDefined();
    const repeatLink = view.getByRole("link", { name: "Book again" });
    const repeatUrl = new URL(
      repeatLink.getAttribute("href") ?? "",
      "https://deskohub.local"
    );
    expect(repeatUrl.pathname).toBe("/en-US/reservation/cowork");
    expect(Object.fromEntries(repeatUrl.searchParams)).toEqual({
      entryTier: "profi",
      coffee: "true",
      monitorOption: "2x27-qhd",
    });
    expect(
      view.queryByText("We will send the reservation details by email.")
    ).toBeNull();
    expect(
      view.container.querySelector("[class*='bg-aquamarine-green/10']")
    ).toBeNull();
  });

  test("keeps the fulfilled default presentation inside the checkout flow", () => {
    const view = render(
      <CheckoutStatusPage locale="en-US" status={reconstructedCoworkStatus} />
    );

    expect(view.container.querySelector("main")).not.toBeNull();
    expect(view.container.querySelector("ol")).not.toBeNull();
    expect(view.getByRole("link", { name: "Book again" })).toBeDefined();
    expect(view.getByRole("link", { name: "Back home" })).toBeDefined();
  });

  test("renders fallback copy without a reconstructed summary", () => {
    const view = render(
      <CheckoutStatusPage locale="en-US" status={baseStatus} />
    );

    expect(
      view.getByText("We will send the reservation details by email.")
    ).toBeDefined();
  });

  test("keeps reservation access outside the payment status page", () => {
    const view = render(
      <CheckoutStatusPage locale="en-US" status={baseStatus} />
    );

    expect(
      view.container.querySelector("[data-reservation-access]")
    ).toBeNull();
    expect(
      view.container.querySelector("[data-reservation-access-code]")
    ).toBeNull();
  });

  test("keeps the default page presentation equivalent to explicit page presentation", () => {
    const defaultView = render(
      <CheckoutStatusPage locale="en-US" status={baseStatus} />
    );
    const defaultMarkup = defaultView.container.innerHTML;
    cleanup();

    const explicitPageView = render(
      <CheckoutStatusPage
        locale="en-US"
        presentation="page"
        status={baseStatus}
      />
    );

    expect(explicitPageView.container.innerHTML).toBe(defaultMarkup);
  });

  test("renders fulfilled modal content without the page shell or page CTAs", () => {
    const view = render(
      <CheckoutStatusPage
        locale="en-US"
        presentation="modal"
        status={reconstructedCoworkStatus}
      />
    );

    expect(view.container.querySelector("main")).toBeNull();
    expect(view.container.querySelector("ol")).toBeNull();
    expect(view.container.firstElementChild?.className).toBe(
      "bg-white p-6 text-navy-blue sm:p-10"
    );
    expect(view.getByText("Reservation summary")).toBeDefined();
    expect(view.getByText("reservation-status-page")).toBeDefined();
    expect(view.getByText("Profi Workstation")).toBeDefined();
    expect(view.getByRole("link", { name: "Show access code" })).toBeDefined();
    expect(
      view.container.querySelector(
        '#checkout-status-access[href="/en-US/reservation/access/reservation-status-page"]'
      )
    ).not.toBeNull();
    expect(
      view.container.querySelector("#checkout-status-reserve-again")
    ).toBeNull();
    expect(view.queryByRole("link", { name: "Back home" })).toBeNull();
    expect(view.container.querySelector('a[href="/en-US"]')).toBeNull();
  });

  test("omits modal reservation CTAs without relying on localized copy", () => {
    const view = render(
      <CheckoutStatusPage
        locale="cs-CZ"
        presentation="modal"
        status={reconstructedCoworkStatus}
      />
    );

    expect(
      view.container.querySelector("#checkout-status-reserve-again")
    ).toBeNull();
    expect(view.container.querySelector('a[href="/cs-CZ"]')).toBeNull();
  });

  test("keeps support in a failed modal without reservation CTAs", () => {
    const view = render(
      <CheckoutStatusPage
        locale="en-US"
        presentation="modal"
        status={{
          ...baseStatus,
          status: "fulfillment_failed",
          fulfillmentStatus: "failed",
        }}
      />
    );

    expect(
      view.getByRole("link", { name: "Send support request" })
    ).toBeDefined();
    expect(
      view.container.querySelector("#checkout-status-reserve-again")
    ).toBeNull();
    expect(view.queryByRole("link", { name: "Back home" })).toBeNull();
  });

  test("omits modal CTAs for not-found and pending states", () => {
    const statuses: CheckoutStatusViewModel[] = [
      {
        orderId: "not-found-modal",
        returnOutcome: "unknown",
        status: "not_found",
      },
      {
        ...baseStatus,
        orderId: "pending-modal",
        status: "pending",
        paymentStatus: "pending",
        fulfillmentStatus: "not_started",
      },
    ];

    for (const status of statuses) {
      const view = render(
        <CheckoutStatusPage
          locale="en-US"
          presentation="modal"
          status={status}
        />
      );

      expect(
        view.container.querySelector("#checkout-status-reserve-again")
      ).toBeNull();
      expect(view.queryByRole("link", { name: "Back home" })).toBeNull();
      expect(
        view.queryByRole("link", { name: "Send support request" })
      ).toBeNull();
      cleanup();
    }
  });

  test("links fulfilled reservations to the canonical access page", () => {
    const view = render(
      <CheckoutStatusPage locale="en-US" status={baseStatus} />
    );

    const accessLink = view.getByRole("link", { name: "Show access code" });
    expect(accessLink.getAttribute("href")).toBe(
      "/en-US/reservation/access/reservation-status-page"
    );
  });

  test("uses soft navigation for access only in modal presentation", () => {
    const accessHref = "/en-US/reservation/access/reservation-status-page";
    const modalView = render(
      <CheckoutStatusPage
        locale="en-US"
        presentation="modal"
        status={baseStatus}
      />
    );

    expect(
      modalView
        .getByRole("link", { name: "Show access code" })
        .getAttribute("href")
    ).toBe(accessHref);
    expect(capturedLinks).toContainEqual({
      href: accessHref,
      prefetch: false,
    });
    cleanup();
    capturedLinks.length = 0;

    const canonicalView = render(
      <CheckoutStatusPage locale="en-US" status={baseStatus} />
    );

    expect(
      canonicalView
        .getByRole("link", { name: "Show access code" })
        .getAttribute("href")
    ).toBe(accessHref);
    expect(capturedLinks.some(({ href }) => href === accessHref)).toBe(false);
    expect(
      canonicalView
        .getByRole("link", { name: "Show access code" })
        .getAttribute("data-next-link")
    ).toBeNull();
  });

  test("keeps the generic meeting-room start when exact duration is unavailable", () => {
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
      view.getByRole("link", { name: "Book again" }).getAttribute("href")
    ).toBe("/en-US/reservation/office?dayCount=3&seats=3");
  });

  test("propagates only allowlisted booking shape", () => {
    const view = render(
      <CheckoutStatusPage
        locale="en-US"
        status={
          {
            ...baseStatus,
            orderId: "operational-order-id",
            supportContactPrefill: {
              name: "Sensitive Customer",
              email: "sensitive@example.com",
              phone: "+420777777777",
            },
            providerOrderId: "provider-order-id",
            paymentAttemptId: "payment-attempt-id",
            discountCode: "SECRET-DISCOUNT",
            accessCode: "123456",
            billing: {
              companyName: "Sensitive Invoice Company",
              taxId: "CZ12345678",
            },
            summary: {
              kind: "cowork",
              entryTier: "basic",
              coffee: false,
              reservedFrom: Temporal.Instant.from("2026-06-19T22:00:00Z"),
              reservedUntil: Temporal.Instant.from("2026-06-20T22:00:00Z"),
              price: { value: 35_000, exponent: 2, currency: "CZK" },
            },
          } as CheckoutStatusViewModel
        }
      />
    );

    const href = view
      .getByRole("link", { name: "Book again" })
      .getAttribute("href");
    const url = new URL(href ?? "", "https://deskohub.local");
    expect([...url.searchParams.keys()]).toEqual(["entryTier", "coffee"]);
    expect(href).not.toContain("operational-order-id");
    expect(href).not.toContain("Sensitive");
    expect(href).not.toContain("sensitive%40example.com");
    expect(href).not.toContain("provider-order-id");
    expect(href).not.toContain("payment-attempt-id");
    expect(href).not.toContain("SECRET-DISCOUNT");
    expect(href).not.toContain("123456");
    expect(href).not.toContain("Invoice");
    expect(href).not.toContain("CZ12345678");
    expect(href).not.toContain("35000");
    expect(href).not.toContain("2026-06");
  });

  test("keeps generic starts for non-fulfilled or unusable booking shapes", () => {
    const nonFulfilled = render(
      <CheckoutStatusPage
        locale="en-US"
        status={{
          ...baseStatus,
          status: "payment_failed",
          paymentStatus: "failed",
          fulfillmentStatus: "not_started",
          summary: {
            kind: "cowork",
            entryTier: "profi",
            coffee: true,
            monitorOption: "2x27-qhd",
            reservedFrom: Temporal.Instant.from("2026-06-19T22:00:00Z"),
            reservedUntil: Temporal.Instant.from("2026-06-20T22:00:00Z"),
            price: { value: 55_000, exponent: 2, currency: "CZK" },
          },
        }}
      />
    );
    expect(
      nonFulfilled
        .getByRole("link", { name: "Start a new reservation" })
        .getAttribute("href")
    ).toBe("/en-US/reservation/cowork");
    cleanup();

    const unusableOffice = render(
      <CheckoutStatusPage
        locale="en-US"
        status={{
          ...baseStatus,
          kind: "office",
          summary: {
            kind: "office",
            reservedFrom: Temporal.Instant.from("2026-06-12T08:00:00Z"),
            reservedUntil: Temporal.Instant.from("2026-06-14T08:00:00Z"),
            seats: 3,
            price: { value: 442_500, exponent: 2, currency: "CZK" },
          },
        }}
      />
    );
    expect(
      unusableOffice
        .getByRole("link", { name: "Start a new reservation" })
        .getAttribute("href")
    ).toBe("/en-US/reservation/office");
    cleanup();

    const fractionalMidnightOffice = render(
      <CheckoutStatusPage
        locale="en-US"
        status={{
          ...baseStatus,
          kind: "office",
          summary: {
            kind: "office",
            reservedFrom: Temporal.Instant.from("2026-06-11T22:00:00.001Z"),
            reservedUntil: Temporal.Instant.from("2026-06-14T22:00:00.001Z"),
            seats: 3,
            price: { value: 442_500, exponent: 2, currency: "CZK" },
          },
        }}
      />
    );
    expect(
      fractionalMidnightOffice
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
        "My payment was received, but the reservation confirmation email did not arrive.",
        "",
        "Order reference: reservation-status-page",
        "Reservation: Basic Day Pass on Saturday, June 20, 2026",
        "",
        "Please help me get my secure access link.",
      ].join("\n")
    );
  });
});
