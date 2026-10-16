import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { within } from "@testing-library/react";
import { prerender } from "react-dom/static";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import { workspaceUseAction } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { AdministrationReservationDetail as ReservationDetailData } from "./administration.service";
import { loadFixtureReservation } from "./fixtures";

mock.module("server-only", () => ({}));
mock.module("next/server", () => ({ connection: () => Promise.resolve() }));
mock.module("@/features/i18n/server/request-locale", () => ({
  getRequestLocale: () => Promise.resolve("cs-CZ"),
}));

mock.module("./actions", () => ({
  cancelAdministrationReservation: mock(),
  mutateReservationAccess: mock(),
}));

let detail: ReservationDetailData | null = null;

mock.module("./page-data.server", () => ({
  loadAdministrationReservation: () => Promise.resolve(detail),
}));

async function prerenderReservationDetail() {
  const { AdministrationReservationDetail } = await import(
    "./reservation-detail"
  );
  const { prelude } = await prerender(
    <RouteLocaleProvider locale="cs-CZ">
      <AdministrationReservationDetail
        params={Promise.resolve({ reservationId: "unused" })}
      />
    </RouteLocaleProvider>,
    // Inline every completed boundary instead of streaming hidden segments.
    { progressiveChunkSize: Number.POSITIVE_INFINITY }
  );
  const container = document.createElement("div");
  container.innerHTML = await new Response(prelude).text();
  return within(container);
}

describe("AdministrationReservationDetail", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
    workspaceUseAction.mockReturnValue({
      execute: mock(),
      isExecuting: false,
    } as never);
  });
  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await unregisterWorkspaceComponentTestEnv();
  });

  test("renders the reservation detail in Czech on a Czech route", async () => {
    const fixture = loadFixtureReservation("0198-admin-fixture-attention");
    expect(fixture).not.toBeNull();
    if (!fixture) return;
    detail = {
      ...fixture,
      operatorNotice: {
        kind: "late_payment_refund_required",
        status: "error",
      },
      discounts: [],
      otherCustomerReservations: [],
    };

    const view = await prerenderReservationDetail();

    expect(view.getByRole("heading", { level: 1 }).textContent).toBe(
      "Zasedací místnost"
    );
    expect(view.getByRole("alert").textContent).toContain(
      "Pozdní platba – nutné vrátit peníze"
    );
    expect(view.getByRole("alert").textContent).toContain(
      "Rezervaci nevyřizujte a platbu vraťte v Nexi."
    );
    for (const heading of [
      "Průběh rezervace",
      "Podrobnosti rezervace",
      "Platební záznamy",
      "Historie",
    ]) {
      expect(view.getByRole("heading", { name: heading })).toBeDefined();
    }
    expect(view.getByText("Dotypos: potvrzená")).toBeDefined();
    expect(view.getByText("Začátek")).toBeDefined();
    expect(view.getByText("Žádné další rezervace.")).toBeDefined();
    expect(view.getByText("Nebyla uplatněna žádná sleva.")).toBeDefined();
    expect(view.getByText("Záznam rezervace")).toBeDefined();
    const history = view.getByRole("list", { name: "Historie rezervace" });
    expect(
      within(history).getByText("Rezervace byla zablokována")
    ).toBeDefined();
    expect(
      within(history).getByText("Potvrzení zákazníkovi selhalo")
    ).toBeDefined();
    expect(view.queryByText("Reservation details")).toBeNull();
  });
});
