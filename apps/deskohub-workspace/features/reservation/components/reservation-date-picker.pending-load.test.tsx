import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import "@/shared/polyfills/temporal";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

// Radix picks its layout-effect hook when it loads, so the DOM must exist
// before the picker is imported for the popover portal to mount.
registerWorkspaceComponentTestEnv();

const calendarModule = await import("@/shared/components/ui/calendar");
const actualPreloadableModule = await import(
  "@/shared/utils/preloadable-module"
);
// mock.module rewrites this namespace in place, so keep the real factory.
const { createPreloadableModule } = actualPreloadableModule;
type CalendarModule = typeof calendarModule;

let resolveCalendarLoad: (module: CalendarModule) => void = () => undefined;
let calendarLoad: Promise<CalendarModule> = Promise.resolve(calendarModule);

mock.module("@/shared/utils/preloadable-module", () => ({
  ...actualPreloadableModule,
  createPreloadableModule: <Module,>() =>
    createPreloadableModule(() => calendarLoad as Promise<Module>),
  usePreloadWhenIdle: () => undefined,
}));

// Each case imports its own picker module so the calendar starts unloaded.
const renderPickerWithPendingCalendar = async (moduleKey: string) => {
  calendarLoad = new Promise<CalendarModule>((resolve) => {
    resolveCalendarLoad = resolve;
  });
  const { ReservationDatePicker } = await import(
    `./reservation-date-picker?${moduleKey}`
  );
  const onBlur = mock(() => undefined);
  const view = render(
    <div>
      <ReservationDatePicker
        ariaLabel="Reservation date"
        onBlur={onBlur}
        value="2099-06-10"
      />
      <button type="button">Elsewhere</button>
      <p>Outside text</p>
    </div>
  );
  const trigger = view.getByRole("button", {
    name: "Reservation date: choose from the calendar",
  });
  const elsewhere = view.getByRole("button", { name: "Elsewhere" });

  trigger.focus();
  act(() => {
    // A keyboard Enter or Space on the trigger button dispatches this click.
    fireEvent.click(trigger);
  });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");

  const finishCalendarLoad = () =>
    act(async () => {
      resolveCalendarLoad(calendarModule);
      await calendarLoad;
    });

  return { elsewhere, finishCalendarLoad, onBlur, trigger, view };
};

const openDialog = () => document.body.querySelector('[role="dialog"]');

describe("ReservationDatePicker deferred calendar load", () => {
  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("opens with focus in the calendar when the trigger keeps focus", async () => {
    const { finishCalendarLoad, onBlur, trigger } =
      await renderPickerWithPendingCalendar("pending-open-kept");

    await finishCalendarLoad();

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const dialog = openDialog();
    expect(dialog?.querySelector('[role="grid"]')).toBeTruthy();
    expect(dialog?.contains(document.activeElement)).toBe(true);
    expect(onBlur).not.toHaveBeenCalled();
  });

  test("stays closed and leaves focus elsewhere when another control is focused", async () => {
    const { elsewhere, finishCalendarLoad, onBlur, trigger } =
      await renderPickerWithPendingCalendar("pending-open-focus-elsewhere");

    act(() => {
      elsewhere.focus();
    });
    await finishCalendarLoad();

    expect({
      expanded: trigger.getAttribute("aria-expanded"),
      focusRemainsElsewhere: document.activeElement === elsewhere,
    }).toEqual({ expanded: "false", focusRemainsElsewhere: true });
    expect(openDialog()).toBeNull();
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  test("stays closed when the user presses outside the picker", async () => {
    const { finishCalendarLoad, onBlur, trigger, view } =
      await renderPickerWithPendingCalendar("pending-open-press-outside");

    act(() => {
      fireEvent.pointerDown(view.getByText("Outside text"));
    });
    await finishCalendarLoad();

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(openDialog()).toBeNull();
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  test("stays closed and keeps focus on the trigger after Escape", async () => {
    const { finishCalendarLoad, onBlur, trigger } =
      await renderPickerWithPendingCalendar("pending-open-escape");

    act(() => {
      fireEvent.keyDown(trigger, { key: "Escape" });
    });
    await finishCalendarLoad();

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(openDialog()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  test("keeps the open request when the trigger itself is pressed again", async () => {
    const { finishCalendarLoad, trigger } =
      await renderPickerWithPendingCalendar("pending-open-trigger-pressed");

    act(() => {
      fireEvent.pointerDown(trigger);
      fireEvent.click(trigger);
    });
    await finishCalendarLoad();

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  test("does nothing when the picker unmounts before the calendar loads", async () => {
    const consoleError = mock(() => undefined);
    const originalConsoleError = console.error;
    console.error = consoleError;
    try {
      const { finishCalendarLoad, onBlur, view } =
        await renderPickerWithPendingCalendar("pending-open-unmounted");

      view.unmount();
      await finishCalendarLoad();

      expect(openDialog()).toBeNull();
      expect(onBlur).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      console.error = originalConsoleError;
    }
  });
});
