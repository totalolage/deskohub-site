import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { m } from "@/features/administration/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import {
  type EventTriggerKind,
  eventTriggerTags,
} from "./automation-flow-editing";
import type { FlowStepValue, FlowTriggerValue } from "./automation-flow-form";
import type { CalendarPreviewView } from "./calendar-preview";
import {
  campaignOperationInputs,
  isValidFlow,
  resetCampaignOperations,
  stubCampaignOperations,
} from "./flow-builder.test-utils";

mock.module("../../campaign-operations.actions", () => ({
  runCampaignOperation: mock(),
}));

registerWorkspaceComponentTestEnv();
// React DOM and Radix detect the DOM when they load, so they load after it.
const { act, cleanup, fireEvent, render } = await import(
  "@testing-library/react"
);
const { TriggerCard } = await import("./trigger-card");

beforeEach(stubCampaignOperations);
afterEach(cleanup);
afterAll(async () => {
  resetCampaignOperations();
  await unregisterWorkspaceComponentTestEnv();
});

const locale = "en-US";
const product = { family: "cowork", properties: [] } as const;
const send: FlowStepValue = { _tag: "Send", id: "send" };
const schedule: FlowTriggerValue = {
  _tag: "Schedule",
  calendar: { weekdays: ["friday"], hours: [8] },
};

const renderTrigger = (
  trigger: FlowTriggerValue | null,
  initialPreview?: CalendarPreviewView,
  errorAt: (field: string) => string | undefined = () => undefined
) => {
  const onChange = mock((_trigger: FlowTriggerValue) => undefined);
  const view = render(
    <RouteLocaleProvider locale={locale}>
      <TriggerCard
        trigger={trigger}
        onChange={onChange}
        initialPreview={initialPreview}
        errorAt={errorAt}
        minutesError={undefined}
      />
    </RouteLocaleProvider>
  );
  /** The radio for a family ("schedule", "event") or an event kind. */
  const choose = (value: string) => {
    const radio = view
      .getAllByRole("radio")
      .find((candidate) => candidate.getAttribute("value") === value);
    if (!radio) throw new Error(`No radio for ${value}`);
    act(() => {
      fireEvent.click(radio);
    });
  };
  const productControl = () =>
    view.queryByRole("combobox", {
      name: m.emailCampaignsAudienceProductSelectLabel({}, { locale }),
    });
  return { view, onChange, choose, productControl };
};

const schedulePreviews = () =>
  campaignOperationInputs("previewCalendarExpression");

const reservationKinds = [
  "reservation-booked",
  "reservation-cancelled",
  "reservation-started",
  "reservation-finished",
] as const satisfies readonly EventTriggerKind[];

/** One reservation event, with neither a product nor a calendar. */
const expectReservationEvent = (
  calls: readonly (readonly [FlowTriggerValue])[]
) => {
  expect(calls).toHaveLength(1);
  const [next] = calls[0] ?? [];
  expect(
    reservationKinds.map((kind) => eventTriggerTags[kind] as string)
  ).toContain(next?._tag);
  expect(Object.keys(next ?? {})).toEqual(["_tag"]);
};

/** One valid schedule, previewed with the calendar it starts from. */
const expectScheduleWithPreview = (
  calls: readonly (readonly [FlowTriggerValue])[]
) => {
  expect(calls).toHaveLength(1);
  const [next] = calls[0] ?? [];
  if (next?._tag !== "Schedule") throw new Error("Expected a schedule");
  expect(isValidFlow({ trigger: next, steps: [send] })).toBe(true);
  expect(schedulePreviews()).toEqual([
    { expression: next.calendar, usage: "trigger", locale },
  ]);
};

describe("trigger family", () => {
  test("a missing trigger is described by its mounted error", () => {
    const unset = renderTrigger(null);
    const choices = unset.view.getByRole("radiogroup");
    expect(choices.getAttribute("aria-invalid")).toBe("false");
    expect(unset.view.getByRole("alert").textContent).toBe("");
    cleanup();

    const refused = renderTrigger(null, undefined, (field) =>
      field === "" ? "Expected a trigger" : undefined
    );
    const invalid = refused.view.getByRole("radiogroup");
    expect(invalid.getAttribute("aria-invalid")).toBe("true");
    const error = refused.view.getByRole("alert");
    expect(invalid.getAttribute("aria-describedby")).toBe(error.id);
    expect(error.textContent).not.toBe("");
  });

  test("choosing a schedule first starts its calendar and previews it", () => {
    const { onChange, choose } = renderTrigger(null);

    choose("schedule");

    expectScheduleWithPreview(onChange.mock.calls);
  });

  test("choosing an event first starts a reservation event", () => {
    const { onChange, choose } = renderTrigger(null);

    choose("event");

    expectReservationEvent(onChange.mock.calls);
    expect(schedulePreviews()).toEqual([]);
  });

  test("switching a schedule to an event replaces the calendar", () => {
    const { onChange, choose } = renderTrigger(schedule);

    choose("event");

    expectReservationEvent(onChange.mock.calls);
  });

  test("switching an event to a schedule drops its product", () => {
    const { onChange, choose } = renderTrigger({
      _tag: "ReservationBooked",
      product,
    });

    choose("schedule");

    expectScheduleWithPreview(onChange.mock.calls);
  });

  test("choosing the current family changes nothing", () => {
    const { onChange, choose } = renderTrigger(schedule);

    choose("schedule");

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("event kind", () => {
  test("switching to account created drops the product", () => {
    const { onChange, choose } = renderTrigger({
      _tag: "ReservationBooked",
      product,
    });

    choose("account-created");

    expect(onChange.mock.calls[0]?.[0]).toStrictEqual({
      _tag: "AccountCreated",
    });
  });

  test.each(reservationKinds)("switching to %s keeps the product", (kind) => {
    const { onChange, choose } = renderTrigger({
      _tag:
        kind === "reservation-booked"
          ? "ReservationFinished"
          : "ReservationBooked",
      product,
    });

    choose(kind);

    expect(onChange.mock.calls).toHaveLength(1);
    expect(onChange.mock.calls[0]?.[0]).toStrictEqual({
      _tag: eventTriggerTags[kind],
      product,
    });
  });

  test("switching from account created starts without a product", () => {
    const { onChange, choose } = renderTrigger({ _tag: "AccountCreated" });

    choose("reservation-booked");

    expect(onChange.mock.calls[0]?.[0]).toStrictEqual({
      _tag: "ReservationBooked",
    });
  });

  test.each(reservationKinds)("%s offers a product filter", (kind) => {
    const { productControl } = renderTrigger({
      _tag: eventTriggerTags[kind],
    });

    expect(productControl()).not.toBeNull();
  });

  test("account created offers no product filter", () => {
    const { productControl } = renderTrigger({ _tag: "AccountCreated" });

    expect(productControl()).toBeNull();
  });

  test("a schedule offers no event kinds or product filter", () => {
    const { view, productControl } = renderTrigger(schedule);

    expect(
      view
        .getAllByRole("radio")
        .map((radio) => radio.getAttribute("value"))
        .sort()
    ).toEqual(["event", "schedule"]);
    expect(productControl()).toBeNull();
  });
});

describe("frequency banner", () => {
  const ready = (firesMoreThanHourly: boolean): CalendarPreviewView => ({
    _tag: "Ready",
    description: "synthetic",
    nextStarts: [],
    frequency: {
      maxFiresPerHour: firesMoreThanHourly ? 4 : 1,
      firesMoreThanHourly,
    },
  });

  test("shows when the port says the schedule fires more than hourly", () => {
    const { view } = renderTrigger(schedule, ready(true));

    expect(view.getAllByRole("note")).toHaveLength(1);
  });

  test("stays hidden for an at most hourly schedule", () => {
    const { view } = renderTrigger(schedule, ready(false));

    expect(view.queryAllByRole("note")).toEqual([]);
  });

  test("stays hidden while the preview failed", () => {
    const { view } = renderTrigger(schedule, {
      _tag: "Failed",
      message: "synthetic",
      code: undefined,
    });

    expect(view.queryAllByRole("note")).toEqual([]);
  });
});
