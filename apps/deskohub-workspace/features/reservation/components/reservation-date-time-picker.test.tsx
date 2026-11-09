import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import type { ComponentProps } from "react";
import "@/shared/polyfills/temporal";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

// React DOM detects input events and Radix picks its layout-effect hook when
// they load, so the DOM must exist before either is imported.
registerWorkspaceComponentTestEnv();
const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { ReservationDateTimePicker } = await import(
  "./reservation-date-time-picker"
);

/** Types a date into the date field and leaves it, which commits it. */
const typeDate = (
  props: Partial<ComponentProps<typeof ReservationDateTimePicker>>,
  text: string
) => {
  const onChange = mock((_value: string) => undefined);
  const view = render(
    <ReservationDateTimePicker
      dateLabel="Start date"
      locale="en-US"
      onChange={onChange}
      timeLabel="Start time"
      {...props}
    />
  );
  const dateInput = view.getByRole("combobox", { name: "Start date" });
  fireEvent.change(dateInput, { target: { value: text } });
  fireEvent.focusOut(dateInput);
  return onChange.mock.calls.map(([value]) => value);
};

describe("ReservationDateTimePicker", () => {
  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("prevents selecting a time before the same-day minimum", () => {
    const onChange = mock(() => undefined);
    let minimum = "2099-06-10T15:00";
    const minimumProps = { minimum: () => minimum };
    const view = render(
      <ReservationDateTimePicker
        dateLabel="Start date"
        {...minimumProps}
        onChange={onChange}
        timeLabel="Start time"
        value="2099-06-10T16:00"
      />
    );
    const timeInput =
      view.container.querySelector<HTMLInputElement>('input[type="time"]');

    expect(timeInput).not.toBeNull();
    expect(timeInput?.min).toBe("15:00");

    minimum = "2099-06-10T17:00";
    fireEvent.input(timeInput!, { target: { value: "16:00" } });

    expect(onChange).not.toHaveBeenCalled();
    expect(timeInput?.value).toBe("16:00");
  });

  test("labels both interactive controls and rejects partial hours", () => {
    const onChange = mock(() => undefined);
    const view = render(
      <ReservationDateTimePicker
        dateLabel="Meeting room start date"
        onChange={onChange}
        timeStepMinutes={60}
        timeLabel="Meeting room start time"
        value="2099-06-10T16:00"
      />
    );

    expect(
      view.getByRole("combobox", { name: "Meeting room start date" })
    ).toBeDefined();
    const timeInput = view.getByLabelText("Meeting room start time");
    expect(timeInput.getAttribute("step")).toBe("3600");

    fireEvent.input(timeInput, { target: { value: "17:00" } });
    expect(onChange).toHaveBeenCalledWith("2099-06-10T17:00");

    onChange.mockClear();
    fireEvent.input(timeInput, { target: { value: "17:30" } });
    expect(onChange).not.toHaveBeenCalled();
    expect((timeInput as HTMLInputElement).value).toBe("16:00");

    fireEvent.input(timeInput, { target: { value: "" } });
    expect(onChange).not.toHaveBeenCalled();
    expect((timeInput as HTMLInputElement).value).toBe("16:00");
  });

  describe("a typed date", () => {
    test("keeps the chosen time on another day than the minimum", () => {
      expect(
        typeDate(
          { minimum: "2099-06-10T15:00", value: "2099-06-10T16:00" },
          "6/12/2099"
        )
      ).toEqual(["2099-06-12T16:00"]);
    });

    test("moves an earlier time up to the minimum on the minimum's day", () => {
      expect(
        typeDate(
          { minimum: () => "2099-06-10T15:00", value: "2099-06-12T09:00" },
          "6/10/2099"
        )
      ).toEqual(["2099-06-10T15:00"]);
      cleanup();
      expect(
        typeDate(
          { minimum: "2099-06-10T15:00", value: "2099-06-12T16:30" },
          "6/10/2099"
        )
      ).toEqual(["2099-06-10T16:30"]);
    });

    test("keeps the time without a time field, even before the minimum", () => {
      expect(
        typeDate(
          {
            minimum: "2099-06-10T15:00",
            showTime: false,
            value: "2099-06-12T09:00",
          },
          "6/10/2099"
        )
      ).toEqual(["2099-06-10T09:00"]);
    });

    test("starts at the default time before any time is chosen", () => {
      expect(typeDate({}, "6/10/2099")).toEqual(["2099-06-10T10:00"]);
    });

    test("keeps wall-clock times across daylight saving changes", () => {
      // 02:30 doesn't exist in Prague on 29 March 2026 and happens twice on
      // 25 October 2026; the picker stores the local time as chosen.
      expect(
        typeDate(
          { minimum: "2026-03-29T02:30", value: "2026-03-28T01:00" },
          "3/29/2026"
        )
      ).toEqual(["2026-03-29T02:30"]);
      cleanup();
      expect(typeDate({ value: "2026-10-24T02:30" }, "10/25/2026")).toEqual([
        "2026-10-25T02:30",
      ]);
      cleanup();
      expect(
        typeDate(
          { minimum: "2028-02-29T23:59", value: "2028-02-28T08:00" },
          "2/29/2028"
        )
      ).toEqual(["2028-02-29T23:59"]);
    });

    test("clears the date and time together for text that is no date", () => {
      expect(typeDate({ value: "2099-06-10T16:00" }, "not a date")).toEqual([
        "",
      ]);
      cleanup();
      expect(typeDate({ value: "2099-06-10T16:00" }, " ")).toEqual([""]);
    });
  });
});
