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
import { CustomerReservationActivity } from "./customer-reservation-activity";
import { formatAdministrationPlainDate } from "./formatters";

const activity = {
  from: "2026-01-01",
  to: "2026-03-31",
  dates: [
    { category: "meeting-room", count: 1, date: "2026-02-03" },
    { category: "office", count: 4, date: "2026-02-10" },
  ],
} as const;

describe("CustomerReservationActivity", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => cleanup());
  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("renders the activity calendar in Czech", () => {
    const view = render(
      <CustomerReservationActivity activity={activity} locale="cs-CZ" />
    );

    expect(
      view.getByRole("heading", { name: "Aktivita rezervací" })
    ).toBeDefined();
    expect(view.getByText("5 rezervací za posledních 365 dní")).toBeDefined();
    expect(
      view.getByText(
        `${formatAdministrationPlainDate("2026-02-10", "cs-CZ")}: 4 rezervace`
      )
    ).toBeDefined();
    expect(
      view.getByText(m.reservationOfficeProductTitle({}, { locale: "cs-CZ" }))
    ).toBeDefined();
    expect(
      view.getByText(m.reservationTierMeetingRoomTitle({}, { locale: "cs-CZ" }))
    ).toBeDefined();
    expect(view.getByText("po")).toBeDefined();
    expect(view.getByText("úno")).toBeDefined();
  });

  test("names days without reservations", () => {
    const view = render(
      <CustomerReservationActivity activity={activity} locale="en-US" />
    );
    const emptyDay = view.container.querySelector(
      'time[datetime="2026-02-04"]'
    );

    expect(emptyDay?.getAttribute("title")).toBe(
      `No reservations on ${formatAdministrationPlainDate("2026-02-04", "en-US")}`
    );
    expect(view.getByText("Mon")).toBeDefined();
  });

  test("reports unavailable activity in Czech", () => {
    const view = render(
      <CustomerReservationActivity
        activity={{ ...activity, dates: null }}
        locale="cs-CZ"
      />
    );

    expect(
      view.getByText("Aktivita rezervací je dočasně nedostupná.")
    ).toBeDefined();
  });
});
