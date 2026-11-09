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
import { m } from "./i18n";
import { ReservationLifecycleMap } from "./reservation-lifecycle-map";
import { getAdministrationLifecycleConditionLabel } from "./reservation-presentation";
import {
  type AdministrationReservationLifecycle,
  getAdministrationReservationLifecycle,
} from "./reservation-status";

const locale = "en-US";

const renderMap = (lifecycle: AdministrationReservationLifecycle) =>
  render(<ReservationLifecycleMap lifecycle={lifecycle} locale={locale} />);

const reachedBadges = (container: HTMLElement) =>
  [...container.querySelectorAll(".sr-only")].filter(
    (element) =>
      element.textContent ===
      m.administrationReservationLifecycleStageReached({}, { locale })
  );

const currentCard = (container: HTMLElement) => {
  const cards = container.querySelectorAll('[aria-current="step"]');
  expect(cards).toHaveLength(1);
  return cards[0] as HTMLElement;
};

describe("ReservationLifecycleMap", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => cleanup());
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("marks the current stage with its condition and the earlier stages as reached", () => {
    const lifecycle = getAdministrationReservationLifecycle({
      fulfillmentState: "processing",
      paymentState: "paid",
      reservationState: "confirming",
    });
    const { container } = renderMap(lifecycle);

    const card = currentCard(container);
    expect(card.textContent).toContain(
      m.administrationReservationLifecycleStagePaid({}, { locale })
    );
    expect(card.textContent).toContain(
      getAdministrationLifecycleConditionLabel(lifecycle.condition, locale)
    );
    expect(card.textContent).toContain(
      m.administrationReservationLifecycleStageCurrent({}, { locale })
    );
    expect(card.querySelector(".lucide-circle-alert")).toBeNull();
    expect(card.className).toContain("border-aquamarine-green/60");
    expect(reachedBadges(container)).toHaveLength(2);
  });

  test("shows the stage note and no badge on stages the reservation has not reached", () => {
    const { container } = renderMap(
      getAdministrationReservationLifecycle({
        fulfillmentState: "not_started",
        paymentState: "not_started",
        reservationState: "draft",
      })
    );

    expect(container.textContent).toContain(
      m.administrationReservationLifecycleStageCompleteNote({}, { locale })
    );
    expect(reachedBadges(container)).toHaveLength(0);
    const unreached = [...container.querySelectorAll(".min-h-20")].filter(
      (card) => !card.hasAttribute("aria-current")
    );
    expect(unreached.length).toBeGreaterThan(0);
    for (const card of unreached) {
      expect(card.className).toContain("text-navy-blue/60");
      expect(card.querySelector(".rounded-full")).toBeNull();
    }
  });

  test("flags a current stage that needs attention with the alert badge", () => {
    const lifecycle = getAdministrationReservationLifecycle({
      fulfillmentState: "not_started",
      paymentState: "failed",
      reservationState: "held",
    });
    const card = currentCard(renderMap(lifecycle).container);

    expect(card.textContent).toContain(
      m.administrationReservationLifecycleStageHeld({}, { locale })
    );
    expect(card.querySelector(".lucide-circle-alert")).not.toBeNull();
    expect(card.className).toContain("border-burned-orange/45");
  });

  test("keeps a current stage the reservation never reached in attention styling over the unreached one", () => {
    const lifecycle = getAdministrationReservationLifecycle({
      fulfillmentState: "not_started",
      latePaymentRecovery: "pending",
      paymentState: "paid",
      reservationState: "cancelled",
    });
    expect(lifecycle.reachedStages).not.toContain(lifecycle.currentStage);
    const card = currentCard(renderMap(lifecycle).container);

    expect(card.textContent).toContain(
      m.administrationReservationLifecycleStageCancelled({}, { locale })
    );
    expect(card.className).toContain("border-burned-orange/45");
    expect(card.className).not.toContain("border-navy-blue/10");
    expect(card.querySelector(".lucide-circle-alert")).not.toBeNull();
  });
});
