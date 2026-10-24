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

const renderCalendar = () =>
  render(
    <ReservationActivityCalendar
      activity={activity}
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

  test("starts each week column on Monday", () => {
    const view = renderCalendar();
    const firstDay = view.container.querySelector("time");
    const cells = [...(firstDay?.parentElement?.children ?? [])];
    const weekdayLabels = [
      ...(firstDay?.parentElement?.previousElementSibling?.children ?? []),
    ].map(({ textContent }) => textContent);

    expect(cells.indexOf(firstDay as Element)).toBe(3);
    for (const [index, cell] of cells.entries()) {
      const date = cell.getAttribute("datetime");
      if (!date) continue;
      expect(Temporal.PlainDate.from(date).dayOfWeek).toBe((index % 7) + 1);
    }
    expect(weekdayLabels[0]).toBe(
      formatWeekday({ isoDay: 1, locale: "en-US" })
    );
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
