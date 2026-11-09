import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { useForm } from "react-hook-form";
import "@/shared/polyfills/temporal";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import type { ReservationFormDateTimeInputProps } from "./reservation-date-time-input";

// React DOM detects input events and Radix picks its layout-effect hook when
// they load, so the DOM must exist before either is imported.
registerWorkspaceComponentTestEnv();

const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { Form, FormField, FormItem, FormLabel, FormMessage } = await import(
  "@/shared/components/ui/form"
);
const { ReservationFormDateTimeInput } = await import(
  "./reservation-date-time-input"
);

const dateLabel = "Meeting room start date";
const timeLabel = "Meeting room start time";
const defaultStartTime = workspaceSiteConstants.reservation.defaultStartTime;

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await unregisterWorkspaceComponentTestEnv();
});

type StartProps = Partial<
  Omit<ReservationFormDateTimeInputProps, "onChange" | "value">
> & { readonly value?: string };

/**
 * The start field in a React Hook Form item, as the meeting-room form lays it
 * out. `changes` lists every value the field reports.
 */
const renderStart = ({ value = "", ...props }: StartProps = {}) => {
  const onChange = mock((_value: string) => undefined);
  const onSubmit = mock((_data: FormData) => undefined);

  function StartForm() {
    const form = useForm<{ startDateTime: string }>({
      defaultValues: { startDateTime: value },
    });

    return (
      <Form {...form}>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(new FormData(event.currentTarget));
          }}
        >
          <FormField
            control={form.control}
            name="startDateTime"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Start</FormLabel>
                <ReservationFormDateTimeInput
                  {...field}
                  dateLabel={dateLabel}
                  locale="en-US"
                  onChange={(next) => {
                    onChange(next);
                    field.onChange(next);
                  }}
                  timeLabel={timeLabel}
                  {...props}
                />
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>
    );
  }

  const view = render(<StartForm />);
  const form = view.container.querySelector("form") as HTMLFormElement;
  const dateField = view.getByRole("combobox") as HTMLInputElement;
  const timeField = view.queryByLabelText(timeLabel) as HTMLInputElement | null;
  const typeDate = (text: string) => {
    fireEvent.change(dateField, { target: { value: text } });
    fireEvent.focusOut(dateField);
  };
  const typeTime = (time: string) => {
    if (!timeField) throw new Error("The start has no time field.");
    fireEvent.input(timeField, { target: { value: time } });
  };
  const changes = () => onChange.mock.calls.map(([next]) => next);
  const submitted = () => new FormData(form).getAll("startDateTime");

  return {
    changes,
    dateField,
    form,
    onSubmit,
    submitted,
    timeField,
    typeDate,
    typeTime,
    view,
  };
};

describe("ReservationFormDateTimeInput", () => {
  test("names the start's date and time, both required", () => {
    const { dateField, timeField, view } = renderStart({
      value: "2099-06-10T16:00",
    });

    expect(dateField.getAttribute("aria-labelledby")).toBe(
      view.getByText("Start").id
    );
    expect(dateField.required).toBe(true);
    expect(timeField?.required).toBe(true);
    expect(timeField?.value).toBe("16:00");
  });

  test("keeps a time before the same-day minimum out, even after the minimum moves", () => {
    let minimum = "2099-06-10T15:00";
    const { changes, submitted, timeField, typeTime } = renderStart({
      minimum: () => minimum,
      value: "2099-06-10T16:00",
    });

    expect(timeField?.min).toBe("15:00");

    // The bound is read at the edit, without a re-render.
    minimum = "2099-06-10T17:00";
    typeTime("16:30");
    typeTime("16:00");
    expect(changes()).toEqual([]);
    expect(submitted()).toEqual(["2099-06-10T16:00"]);
  });

  test("takes whole hours only with a 60-minute step", () => {
    const { changes, submitted, timeField, typeTime } = renderStart({
      stepMinutes: 60,
      value: "2099-06-10T16:00",
    });

    expect(timeField?.getAttribute("step")).toBe("3600");
    typeTime("17:00");
    expect(changes()).toEqual(["2099-06-10T17:00"]);

    // A partial hour stays on screen without becoming the start. Leaving the
    // field keeps it there and takes the start away, so no earlier time can
    // be submitted in its place.
    typeTime("17:30");
    expect(changes()).toEqual(["2099-06-10T17:00"]);
    if (timeField) fireEvent.blur(timeField);
    expect(timeField?.value).toBe("17:30");
    expect(submitted()).toEqual([""]);
  });

  test("a cleared time keeps the form from submitting the start", () => {
    const { changes, form, onSubmit, submitted, timeField, typeTime } =
      renderStart({ stepMinutes: 60, value: "2099-06-10T16:00" });

    typeTime("");
    expect(changes()).toEqual([]);
    expect(submitted()).toEqual([""]);
    fireEvent.submit(form);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(timeField);
  });

  describe("a typed date", () => {
    test("keeps the chosen time on another day than the minimum", () => {
      const { changes, typeDate } = renderStart({
        minimum: "2099-06-10T15:00",
        value: "2099-06-10T16:00",
      });
      typeDate("6/12/2099");
      expect(changes()).toEqual(["2099-06-12T16:00"]);
    });

    test("moves an earlier time up to the minimum on the minimum's day", () => {
      const earlier = renderStart({
        minimum: () => "2099-06-10T15:00",
        value: "2099-06-12T09:00",
      });
      earlier.typeDate("6/10/2099");
      expect(earlier.changes()).toEqual(["2099-06-10T15:00"]);
      cleanup();

      const later = renderStart({
        minimum: "2099-06-10T15:00",
        value: "2099-06-12T16:30",
      });
      later.typeDate("6/10/2099");
      expect(later.changes()).toEqual(["2099-06-10T16:30"]);
    });

    test("starts at the workspace's default start time before any time is chosen", () => {
      const { changes, submitted, typeDate } = renderStart();
      typeDate("6/10/2099");
      expect(changes()).toEqual([`2099-06-10T${defaultStartTime}`]);
      expect(submitted()).toEqual([`2099-06-10T${defaultStartTime}`]);
    });

    test("uses a time chosen before the date", () => {
      const { changes, typeDate, typeTime } = renderStart({ stepMinutes: 60 });
      typeTime("14:00");
      typeDate("6/10/2099");
      expect(changes()).toEqual(["2099-06-10T14:00"]);
    });

    test("keeps wall-clock times across daylight saving changes", () => {
      // 02:30 doesn't exist in Prague on 29 March 2026 and happens twice on
      // 25 October 2026; the field stores the local time as chosen.
      const springForward = renderStart({
        minimum: "2026-03-29T02:30",
        value: "2026-03-28T01:00",
      });
      springForward.typeDate("3/29/2026");
      expect(springForward.changes()).toEqual(["2026-03-29T02:30"]);
      cleanup();

      const fallBack = renderStart({ value: "2026-10-24T02:30" });
      fallBack.typeDate("10/25/2026");
      expect(fallBack.changes()).toEqual(["2026-10-25T02:30"]);
      cleanup();

      const leapDay = renderStart({
        minimum: "2028-02-29T23:59",
        value: "2028-02-28T08:00",
      });
      leapDay.typeDate("2/29/2028");
      expect(leapDay.changes()).toEqual(["2028-02-29T23:59"]);
    });

    test("clears the date and time together for text that is no date", () => {
      const invalid = renderStart({ value: "2099-06-10T16:00" });
      invalid.typeDate("not a date");
      expect(invalid.changes()).toEqual([""]);
      cleanup();

      const blank = renderStart({ value: "2099-06-10T16:00" });
      blank.typeDate(" ");
      expect(blank.changes()).toEqual([""]);
    });
  });

  describe("for a whole day", () => {
    test("takes only the date and submits the whole start under the field's name", () => {
      const { dateField, submitted, timeField } = renderStart({
        value: "2099-06-10T16:00",
        wholeDay: true,
      });

      expect(timeField).toBeNull();
      expect(dateField.required).toBe(true);
      expect(submitted()).toEqual(["2099-06-10T16:00"]);
    });

    test("keeps the time, even before the minimum, on the minimum's day", () => {
      const { changes, submitted, typeDate } = renderStart({
        minimum: () => "2099-06-10T15:00",
        value: "2099-06-12T09:00",
        wholeDay: true,
      });
      typeDate("6/10/2099");
      expect(changes()).toEqual(["2099-06-10T09:00"]);
      expect(submitted()).toEqual(["2099-06-10T09:00"]);
    });

    test("rejects a date before the minimum's day", () => {
      const { changes, dateField, typeDate } = renderStart({
        minimum: "2099-06-10T00:00",
        value: "2099-06-12T09:00",
        wholeDay: true,
      });
      typeDate("6/9/2099");
      expect(changes()).toEqual([""]);
      expect(dateField.getAttribute("aria-invalid")).toBe("true");
    });

    test("starts at the default start time and clears the whole start", () => {
      const { changes, typeDate } = renderStart({ wholeDay: true });
      typeDate("6/10/2099");
      typeDate("");
      expect(changes()).toEqual([`2099-06-10T${defaultStartTime}`, ""]);
    });
  });
});
