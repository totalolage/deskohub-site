import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { CheckoutSteps } from "./checkout-flow-layout";

describe("CheckoutSteps", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("renders four ordered steps starting with the display-only choose-space step", () => {
    const view = render(<CheckoutSteps activeStepKey="pay" locale="en-US" />);
    const items = view.getAllByRole("listitem");

    expect(items).toHaveLength(4);
    expect(items[0]?.textContent).toContain(
      m.checkoutOrderStepChooseSpace({}, { locale: "en-US" })
    );
    expect(items[1]?.textContent).toContain(
      m.checkoutOrderStepReservation({}, { locale: "en-US" })
    );
    expect(items[2]?.textContent).toContain(
      m.checkoutOrderStepPayment({}, { locale: "en-US" })
    );
    expect(items[3]?.textContent).toContain(
      m.checkoutOrderStepAccess({}, { locale: "en-US" })
    );
  });

  test("marks prior steps completed and exposes progress accessibly in both locales", () => {
    const progressions = [
      {
        activeStepKey: "order",
        activeStepIndex: 1,
        currentStepLabel: m.checkoutOrderStepReservation,
      },
      {
        activeStepKey: "pay",
        activeStepIndex: 2,
        currentStepLabel: m.checkoutOrderStepPayment,
      },
      {
        activeStepKey: "access",
        activeStepIndex: 3,
        currentStepLabel: m.checkoutOrderStepAccess,
      },
    ] as const;

    for (const locale of ["en-US", "cs-CZ"] as const) {
      for (const {
        activeStepKey,
        activeStepIndex,
        currentStepLabel,
      } of progressions) {
        const view = render(
          <CheckoutSteps activeStepKey={activeStepKey} locale={locale} />
        );
        const stepsList = view.getByRole("list", {
          name: m.checkoutOrderStepsLabel({}, { locale }),
        });
        const items = view.getAllByRole("listitem");
        const completedLabel = m.checkoutOrderStepCompleted({}, { locale });
        const completedBadgeClass = items[0]?.querySelector("span")?.className;

        expect(stepsList.tagName).toBe("OL");
        expect(items).toHaveLength(4);
        expect(completedBadgeClass).toBeTruthy();
        expect(items[activeStepIndex]?.textContent).toContain(
          currentStepLabel({}, { locale })
        );
        expect(
          items.filter((item) => item.getAttribute("aria-current") === "step")
        ).toHaveLength(1);
        expect(items[0]?.querySelector("a")).toBeNull();

        for (const [index, item] of items.entries()) {
          const badge = item.querySelector("span");

          expect(badge).not.toBeNull();

          if (index < activeStepIndex) {
            expect(badge?.className).toBe(completedBadgeClass);
            expect(badge?.classList.contains("bg-aquamarine-green")).toBe(true);
            expect(badge?.classList.contains("text-aquamarine-ink")).toBe(true);
            expect(badge?.textContent?.trim()).toBe("");
            expect(item.querySelector("svg.lucide-check")).not.toBeNull();
            expect(item.querySelector(".sr-only")?.textContent).toBe(
              completedLabel
            );
            expect(item.getAttribute("aria-current")).toBeNull();
            continue;
          }

          expect(badge?.textContent?.trim()).toBe(String(index + 1));
          expect(item.querySelector("svg.lucide-check")).toBeNull();
          expect(item.querySelector(".sr-only")).toBeNull();

          if (index === activeStepIndex) {
            expect(item.getAttribute("aria-current")).toBe("step");
            expect(badge?.classList.contains("bg-burned-orange")).toBe(true);
            expect(badge?.classList.contains("text-white")).toBe(true);
          } else {
            expect(item.getAttribute("aria-current")).toBeNull();
            expect(badge?.classList.contains("border-white/18")).toBe(true);
            expect(badge?.classList.contains("text-white/64")).toBe(true);
          }
        }

        cleanup();
      }
    }
  });

  test("renders catalog step labels in both locales", () => {
    for (const locale of ["en-US", "cs-CZ"] as const) {
      const view = render(
        <CheckoutSteps activeStepKey="order" locale={locale} />
      );

      expect(
        view.getByText(m.checkoutOrderStepChooseSpace({}, { locale }))
      ).toBeTruthy();
      expect(
        view.getByText(m.checkoutOrderStepCompleted({}, { locale }))
      ).toBeTruthy();
      expect(
        view.getByText(m.checkoutOrderStepReservation({}, { locale }))
      ).toBeTruthy();
      expect(
        view.getByText(m.checkoutOrderStepPayment({}, { locale }))
      ).toBeTruthy();
      expect(
        view.getByText(m.checkoutOrderStepAccess({}, { locale }))
      ).toBeTruthy();
      cleanup();
    }
  });

  test("links only configured real steps and never links the choose-space step", () => {
    const reservationHref =
      "/en-US/reservation/cowork?payState=encrypted-pay-state";
    const view = render(
      <CheckoutSteps
        activeStepKey="pay"
        locale="en-US"
        stepLinks={{ order: { href: reservationHref, prefetch: false } }}
      />
    );
    const reservationLabel = m.checkoutOrderStepReservation(
      {},
      { locale: "en-US" }
    );
    const paymentLabel = m.checkoutOrderStepPayment({}, { locale: "en-US" });

    const reservationLink = view.getByRole("link", {
      name: new RegExp(reservationLabel, "i"),
    });

    expect(reservationLink.getAttribute("href")).toBe(reservationHref);
    expect(reservationLink.classList.contains("focus-visible:ring-2")).toBe(
      true
    );
    expect(
      reservationLink.classList.contains("focus-visible:ring-burned-orange")
    ).toBe(true);
    expect(
      view.getByText(paymentLabel).closest("li")?.getAttribute("aria-current")
    ).toBe("step");
    expect(
      view.queryByRole("link", { name: new RegExp(paymentLabel, "i") })
    ).toBeNull();
    expect(
      view.queryByRole("link", {
        name: new RegExp(
          m.checkoutOrderStepChooseSpace({}, { locale: "en-US" }),
          "i"
        ),
      })
    ).toBeNull();
  });

  test("keeps configured client and document links on completed real steps", () => {
    const clientHref = "/en-US/reservation/cowork?step=order";
    const documentHref = "/en-US/checkout/pay?step=payment";
    const view = render(
      <CheckoutSteps
        activeStepKey="access"
        locale="en-US"
        stepLinks={{
          order: { href: clientHref, prefetch: false },
          pay: { href: documentHref, navigation: "document" },
        }}
      />
    );
    const reservationLink = view.getByRole("link", {
      name: new RegExp(
        m.checkoutOrderStepReservation({}, { locale: "en-US" }),
        "i"
      ),
    });
    const paymentLink = view.getByRole("link", {
      name: new RegExp(
        m.checkoutOrderStepPayment({}, { locale: "en-US" }),
        "i"
      ),
    });

    expect(reservationLink.getAttribute("href")).toBe(clientHref);
    expect(paymentLink.getAttribute("href")).toBe(documentHref);
    for (const link of [reservationLink, paymentLink]) {
      expect(link.classList.contains("focus-visible:ring-2")).toBe(true);
      expect(link.classList.contains("focus-visible:ring-burned-orange")).toBe(
        true
      );
    }
  });
});
