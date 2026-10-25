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
import { formatWeekday } from "@/shared/utils/date-time-format";
import {
  getReservationActivityCountAppearance,
  getReservationActivityIntensity,
  ReservationActivityCalendar,
  ReservationActivitySwatch,
} from "./reservation-activity-calendar";

const activity = {
  // A Thursday, so the first week column needs three leading Monday-first
  // placeholders.
  from: "2026-01-01",
  to: "2026-03-31",
  dates: [
    { count: 1, date: "2026-02-03" },
    { count: 6, date: "2026-02-10" },
  ],
} as const;

const renderCalendar = (from: string = activity.from) =>
  render(
    <ReservationActivityCalendar
      activity={{ ...activity, from }}
      getDayAppearance={({ count }) =>
        getReservationActivityCountAppearance(count)
      }
      legend={[0, 6].map((count) => (
        <ReservationActivitySwatch
          key={count}
          {...getReservationActivityCountAppearance(count)}
        />
      ))}
      locale="en-US"
    />
  );

const getDayCells = (view: ReturnType<typeof render>) => {
  const firstDay = view.container.querySelector("time");
  return {
    cells: [...(firstDay?.parentElement?.children ?? [])],
    firstDay,
  };
};

describe("getReservationActivityIntensity", () => {
  test("leaves an empty day unfilled", () => {
    expect(getReservationActivityIntensity(0)).toBe(0);
  });

  test("fills six reservations halfway", () => {
    expect(getReservationActivityIntensity(6)).toBe(0.5);
    expect(getReservationActivityIntensity(12)).toBe(0.75);
  });

  test("grows with the count and approaches a full fill", () => {
    const counts = [1, 2, 6, 12, 24, 60, 600];
    const intensities = counts.map(getReservationActivityIntensity);
    for (const [index, intensity] of intensities.entries()) {
      expect(intensity).toBeGreaterThan(intensities[index - 1] ?? 0);
      expect(intensity).toBeLessThanOrEqual(1);
    }
    expect(getReservationActivityIntensity(60)).toBeGreaterThan(0.99);
  });
});

describe("getReservationActivityCountAppearance", () => {
  test("fills a day with green at the count's intensity", () => {
    expect(getReservationActivityCountAppearance(0).style).toBeUndefined();
    expect(getReservationActivityCountAppearance(6)).toEqual({
      className: "bg-aquamarine-green/(--reservation-activity-intensity)",
      style: { "--reservation-activity-intensity": "50%" },
    });
  });
});

describe("ReservationActivityCalendar", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => cleanup());
  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  for (const [from, leadingDays] of [
    ["2026-01-01", 3],
    ["2026-01-04", 6],
    ["2026-01-05", 0],
  ] as const) {
    test(`starts each week column on Monday from ${from}`, () => {
      const view = renderCalendar(from);
      const { cells, firstDay } = getDayCells(view);
      const weekdayLabels = [
        ...(firstDay?.parentElement?.previousElementSibling?.children ?? []),
      ].map(({ textContent }) => textContent);

      expect(firstDay?.getAttribute("datetime")).toBe(from);
      expect(cells.indexOf(firstDay as Element)).toBe(leadingDays);
      for (const [index, cell] of cells.entries()) {
        const date = cell.getAttribute("datetime");
        if (!date) continue;
        expect(Temporal.PlainDate.from(date).dayOfWeek).toBe((index % 7) + 1);
      }
      expect(weekdayLabels[0]).toBe(
        formatWeekday({ isoDay: 1, locale: "en-US" })
      );
    });
  }

  test("labels each month above the week column holding its first day", () => {
    const view = renderCalendar();
    const { cells, firstDay } = getDayCells(view);
    const monthLabels = [
      ...(firstDay?.parentElement?.parentElement?.previousElementSibling
        ?.lastElementChild?.children ?? []),
    ];
    const monthStartColumns = cells.flatMap((cell, index) =>
      cell.getAttribute("datetime")?.endsWith("-01")
        ? [Math.floor(index / 7)]
        : []
    );

    expect(monthStartColumns).toEqual([0, 4, 8]);
    expect(monthLabels).toHaveLength(Math.ceil(cells.length / 7));
    for (const [column, label] of monthLabels.entries()) {
      expect(Boolean(label.textContent)).toBe(
        monthStartColumns.includes(column)
      );
    }
  });

  test("keeps day cells and legend swatches square", () => {
    const view = renderCalendar();
    const squares = view.container.querySelectorAll("time, span.size-3");

    expect(squares.length).toBeGreaterThan(2);
    for (const square of squares) {
      expect(square.className).not.toContain("rounded");
    }
  });

  test("shades days by reservation count", () => {
    const view = renderCalendar();
    const day = (date: string) =>
      view.container.querySelector<HTMLElement>(`time[datetime="${date}"]`);

    const intensity = (date: string) =>
      day(date)?.style.getPropertyValue("--reservation-activity-intensity");

    expect(intensity("2026-02-04")).toBe("");
    expect(intensity("2026-02-03")).toBe("10.9%");
    expect(intensity("2026-02-10")).toBe("50%");
  });

  test("shows no calendar when activity is unavailable", () => {
    const view = render(
      <ReservationActivityCalendar
        activity={{ ...activity, dates: null }}
        getDayAppearance={({ count }) =>
          getReservationActivityCountAppearance(count)
        }
        legend={null}
        locale="en-US"
      />
    );

    expect(view.container.querySelector("time")).toBeNull();
  });
});
