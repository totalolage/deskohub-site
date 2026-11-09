import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import type { CalendarExpressionType as CalendarExpression } from "@deskohub/workspace-admin-api";
import { m } from "@/features/administration/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { CalendarUsage } from "./calendar-preview";
import { openMenu } from "./flow-builder.test-utils";

registerWorkspaceComponentTestEnv();
// React DOM and Radix detect the DOM when they load, so they load after it.
const { act, cleanup, fireEvent, render, within } = await import(
  "@testing-library/react"
);
const { CalendarExpressionEditor } = await import(
  "./calendar-expression-editor"
);

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

const locale = "en-US";
const partName = (part: keyof CalendarExpression) =>
  m.emailAutomationFlowCalendarPart({ part }, { locale });

const renderEditor = (
  value: CalendarExpression,
  {
    usage = "trigger",
    minutesError,
  }: { readonly usage?: CalendarUsage; readonly minutesError?: string } = {}
) => {
  const onChange = mock((_value: CalendarExpression) => undefined);
  const view = render(
    <RouteLocaleProvider locale={locale}>
      <CalendarExpressionEditor
        value={value}
        onChange={onChange}
        usage={usage}
        minutesError={minutesError}
      />
    </RouteLocaleProvider>
  );
  const minutes = () => view.getByRole("group", { name: partName("minutes") });
  const quarters = () => within(minutes()).getAllByRole("button");
  return { view, onChange, minutes, quarters };
};

describe("schedule minutes", () => {
  test("offer the four quarter hours and no typed minute", () => {
    const { view, quarters } = renderEditor({ minutes: [0], hours: [9] });

    expect(quarters()).toHaveLength(4);
    expect(view.queryByRole("spinbutton")).toBeNull();
  });

  test.each([
    [0, [0, 30]],
    [1, [15, 30]],
    [3, [30, 45]],
  ])("pressing quarter %i beside :30 chooses minutes %p", (index, minutes) => {
    const { onChange, quarters } = renderEditor({ minutes: [30], hours: [9] });

    act(() => {
      fireEvent.click(quarters()[index] as HTMLElement);
    });

    expect(onChange.mock.calls).toEqual([[{ minutes, hours: [9] }]]);
  });

  test("releasing a chosen quarter removes its minute", () => {
    const { onChange, quarters } = renderEditor({
      minutes: [0, 30],
      hours: [9],
    });

    act(() => {
      fireEvent.click(quarters()[2] as HTMLElement);
    });

    expect(onChange.mock.calls).toEqual([[{ minutes: [0], hours: [9] }]]);
  });

  test("keeps the last chosen quarter from being released", () => {
    const { onChange, quarters } = renderEditor({ minutes: [15], hours: [9] });

    expect(
      quarters().map((quarter) => quarter.hasAttribute("disabled"))
    ).toEqual([false, true, false, false]);
    act(() => {
      fireEvent.click(quarters()[1] as HTMLElement);
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  test("let a saved minute off the quarter hours be removed", () => {
    const { view, onChange } = renderEditor({ minutes: [0, 5], hours: [9] });

    act(() => {
      fireEvent.click(
        view.getByRole("button", {
          name: m.emailAutomationFlowCalendarRemoveValue(
            { value: ":05" },
            { locale }
          ),
        })
      );
    });

    expect(onChange.mock.calls).toEqual([[{ minutes: [0], hours: [9] }]]);
  });

  test("show the port's refusal in an alert on the minutes row", () => {
    const refusal = "synthetic minutes refusal";
    const { view, minutes } = renderEditor(
      { minutes: [0], hours: [9] },
      { minutesError: refusal }
    );

    const minutesRow = minutes().closest("li") as HTMLElement;
    const alert = within(minutesRow).getByRole("alert");
    expect(alert.textContent).toBe(refusal);
    expect(minutes().getAttribute("aria-describedby")).toBe(alert.id);
    expect(
      view.getAllByRole("alert").filter((alert) => alert.textContent !== "")
    ).toHaveLength(1);
  });

  test("leave the minutes row's alert empty without a refusal", () => {
    const { view, minutes } = renderEditor({ minutes: [0], hours: [9] });

    const minutesRow = minutes().closest("li") as HTMLElement;
    expect(within(minutesRow).getByRole("alert").textContent).toBe("");
    expect(minutes().hasAttribute("aria-describedby")).toBe(false);
    expect(
      view.getAllByRole("alert").filter((alert) => alert.textContent !== "")
    ).toEqual([]);
  });
});

describe("wait minutes", () => {
  const otherMinute = () =>
    m.emailAutomationFlowCalendarMinuteOther({}, { locale });

  test("take a typed minute beside the quarter hours", () => {
    const { view, onChange, quarters } = renderEditor(
      { minutes: [0], hours: [9] },
      { usage: "wait" }
    );

    expect(quarters()).toHaveLength(4);
    act(() => {
      fireEvent.change(view.getByRole("spinbutton", { name: otherMinute() }), {
        target: { value: "7" },
      });
    });
    act(() => {
      fireEvent.click(
        view.getByRole("button", {
          name: m.emailAutomationFlowCalendarMinuteAdd({}, { locale }),
        })
      );
    });

    expect(onChange.mock.calls).toEqual([[{ minutes: [0, 7], hours: [9] }]]);
  });

  test("keep typed minutes while the quarter hours change", () => {
    const { onChange, quarters } = renderEditor(
      { minutes: [0, 7], hours: [9] },
      { usage: "wait" }
    );

    act(() => {
      fireEvent.click(quarters()[1] as HTMLElement);
    });

    expect(onChange.mock.calls).toEqual([
      [{ minutes: [0, 7, 15], hours: [9] }],
    ]);
  });
});

describe("calendar parts", () => {
  const removePart = (part: keyof CalendarExpression) =>
    m.emailAutomationFlowCalendarRemovePart(
      { part: partName(part) },
      { locale }
    );

  test("add an unused part with a starting value", async () => {
    const { view, onChange } = renderEditor({ hours: [9] });

    await openMenu(
      view.getByRole("button", {
        name: m.emailAutomationFlowCalendarAddPart({}, { locale }),
      })
    );
    expect(view.getAllByRole("menuitem")).toHaveLength(6);
    act(() => {
      fireEvent.click(
        view.getByRole("menuitem", { name: partName("weekdays") })
      );
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const [next] = onChange.mock.calls[0] ?? [];
    expect(next?.hours).toEqual([9]);
    expect(next?.weekdays).toHaveLength(1);
  });

  test("change a part's values", () => {
    const { view, onChange } = renderEditor({
      hours: [9],
      weekdays: ["monday"],
    });

    act(() => {
      fireEvent.click(
        within(view.getByRole("group", { name: partName("hours") })).getByRole(
          "button",
          { name: "10:00" }
        )
      );
    });

    expect(onChange.mock.calls).toEqual([
      [{ hours: [9, 10], weekdays: ["monday"] }],
    ]);
  });

  test("remove a part while another remains", () => {
    const { view, onChange } = renderEditor({
      hours: [9],
      weekdays: ["monday"],
    });

    const [remove] = view.getAllByRole("button", { name: removePart("hours") });
    act(() => {
      fireEvent.click(remove as HTMLElement);
    });

    expect(onChange.mock.calls).toEqual([[{ weekdays: ["monday"] }]]);
  });

  test("keep the only part from being removed", () => {
    const { view, onChange } = renderEditor({ hours: [9] });

    const removes = view.getAllByRole("button", { name: removePart("hours") });
    expect(removes.length).toBeGreaterThan(0);
    for (const remove of removes) {
      expect(remove.hasAttribute("disabled")).toBe(true);
      act(() => {
        fireEvent.click(remove);
      });
    }
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("part values", () => {
  const group = (
    view: ReturnType<typeof renderEditor>["view"],
    part: keyof CalendarExpression
  ) => within(view.getByRole("group", { name: partName(part) }));
  const press = (button: HTMLElement) =>
    act(() => {
      fireEvent.click(button);
    });

  test("add a weekday", () => {
    const { view, onChange } = renderEditor({ weekdays: ["monday"] });

    press(group(view, "weekdays").getByRole("button", { name: "Tue" }));

    expect(onChange.mock.calls).toEqual([
      [{ weekdays: ["monday", "tuesday"] }],
    ]);
  });

  test("add the last day of the month", () => {
    const { view, onChange } = renderEditor({ daysOfMonth: [1] });
    const days = group(view, "daysOfMonth");

    expect(days.getAllByRole("button")).toHaveLength(32);
    press(
      days.getByRole("button", {
        name: m.emailAutomationFlowCalendarLastDay({}, { locale }),
      })
    );

    expect(onChange.mock.calls).toEqual([[{ daysOfMonth: [1, "last"] }]]);
  });

  test("add a month", () => {
    const { view, onChange } = renderEditor({ months: [1] });
    const months = group(view, "months");

    expect(months.getAllByRole("button")).toHaveLength(12);
    press(months.getByRole("button", { name: "Feb" }));

    expect(onChange.mock.calls).toEqual([[{ months: [1, 2] }]]);
  });

  test("add the next unused weekday occurrence", () => {
    const { view, onChange } = renderEditor({
      weekdayOccurrences: [{ occurrence: 1, weekday: "monday" }],
    });

    press(
      view.getByRole("button", {
        name: m.emailAutomationFlowCalendarOccurrenceAdd({}, { locale }),
      })
    );

    expect(onChange.mock.calls).toEqual([
      [
        {
          weekdayOccurrences: [
            { occurrence: 1, weekday: "monday" },
            { occurrence: 1, weekday: "tuesday" },
          ],
        },
      ],
    ]);
  });

  test("add a typed week in order", () => {
    const { view, onChange } = renderEditor({ weeksOfYear: [30] });

    act(() => {
      fireEvent.change(
        view.getByRole("spinbutton", {
          name: m.emailAutomationFlowCalendarWeekOther({}, { locale }),
        }),
        { target: { value: "23" } }
      );
    });
    press(
      view.getByRole("button", {
        name: m.emailAutomationFlowCalendarWeekAdd({}, { locale }),
      })
    );

    expect(onChange.mock.calls).toEqual([[{ weeksOfYear: [23, 30] }]]);
  });

  test("remove a week while another remains", () => {
    const { view, onChange } = renderEditor({ weeksOfYear: [23, 30] });
    const removeWeek = (week: number) =>
      view.getByRole("button", {
        name: m.emailAutomationFlowCalendarRemoveValue(
          {
            value: m.emailAutomationFlowCalendarWeekValue({ week }, { locale }),
          },
          { locale }
        ),
      });

    press(removeWeek(23));

    expect(onChange.mock.calls).toEqual([[{ weeksOfYear: [30] }]]);
  });

  test("switch a part to another in its place, with its starting value", async () => {
    const { view, onChange } = renderEditor({ hours: [9], months: [3] });

    const [hoursPart] = view.getAllByRole("combobox", {
      name: m.emailAutomationFlowCalendarPartLabel({}, { locale }),
    });
    await act(async () => {
      fireEvent.keyDown(hoursPart as HTMLElement, { key: "Enter" });
    });
    const weekdays = await view.findByRole("option", {
      name: partName("weekdays"),
    });
    await act(async () => {
      weekdays.focus();
    });
    await act(async () => {
      fireEvent.keyDown(weekdays, { key: "Enter" });
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const [next] = onChange.mock.calls[0] ?? [];
    expect(Object.keys(next ?? {})).toEqual(["weekdays", "months"]);
    expect(next?.months).toEqual([3]);
    expect(next?.weekdays).toHaveLength(1);
  });
});
