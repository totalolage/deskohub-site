import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import {
  workspaceRouterPush,
  workspaceRouterRefresh,
} from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { AdministrationReservationSummary } from "./administration.service";
import { loadFixtureReservations } from "./fixtures";
import { m } from "./i18n";

const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  useParams: () => ({ locale: "en-US" }),
  useRouter: () => ({
    push: workspaceRouterPush,
    refresh: workspaceRouterRefresh,
  }),
}));

const { ReservationTable } = await import("./reservation-table");

const reservationPath = "/en-US/admin/reservations/";

/** The reservation ids in the table's row order, read from each row's detail link. */
const rowReservationIds = (table: HTMLElement) =>
  within(table)
    .getAllByRole("row")
    .slice(1)
    .map(
      (row) =>
        within(row)
          .getAllByRole("link")
          .map((link) => link.getAttribute("href") ?? "")
          .find((href) => href.startsWith(reservationPath))
          ?.slice(reservationPath.length) ?? null
    );

describe("ReservationTable", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => cleanup());
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("sorts by the booked date, then the start time, then rows with neither", () => {
    const [base] = loadFixtureReservations({}).items;
    expect(base).toBeDefined();
    if (!base) return;
    const reservation = (
      id: string,
      dates: Pick<AdministrationReservationSummary, "date" | "startsAt">
    ): AdministrationReservationSummary => ({ ...base, ...dates, id });

    const view = render(
      <ReservationTable
        reservations={[
          reservation("booked-date", {
            date: "2026-11-03",
            startsAt: "2026-10-01T09:00:00Z",
          }),
          reservation("start-only", {
            date: null,
            startsAt: "2026-11-01T09:00:00Z",
          }),
          reservation("undated", { date: null, startsAt: null }),
        ]}
      />
    );
    const table = view.getByRole("table", {
      name: m.administrationReservationTableLabel({}, { locale: "en-US" }),
    });

    fireEvent.click(
      within(table).getByRole("button", {
        name: new RegExp(
          m.administrationReservationTableDate({}, { locale: "en-US" })
        ),
      })
    );

    expect(rowReservationIds(table)).toEqual([
      "undated",
      "start-only",
      "booked-date",
    ]);
  });
});
