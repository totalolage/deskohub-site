import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import {
  AdministrationCampaignDetail,
  AdministrationCampaignId,
  AutomationDetail,
} from "@deskohub/workspace-admin-api";
import { Schema } from "effect";
import { m } from "@/features/administration/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import { workspaceUseAction } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { defaultScheduleCalendar } from "./automation-flow-editing";
import type { FlowStepValue } from "./automation-flow-form";
import {
  campaignOperationInputs,
  openMenu,
  resetCampaignOperations,
  stubCampaignOperations,
} from "./flow-builder.test-utils";

mock.module("../../campaign-operations.actions", () => ({
  runCampaignOperation: mock(),
}));

registerWorkspaceComponentTestEnv();
// React DOM and Radix detect the DOM when they load, so they load after it.
const { act, cleanup, fireEvent, render, within } = await import(
  "@testing-library/react"
);
const { AutomationFlowBuilder } = await import("./automation-flow-builder");
const { InsertStepMenu } = await import("./flow-step-frame");
const { stepLabel } = await import("./step-cards");

beforeEach(stubCampaignOperations);
afterEach(cleanup);
afterAll(async () => {
  resetCampaignOperations();
  await unregisterWorkspaceComponentTestEnv();
});

const locale = "en-US";
const campaignId = AdministrationCampaignId.make(
  "01990000-0000-7000-8000-000000000001"
);
const campaign = Schema.decodeUnknownSync(AdministrationCampaignDetail)({
  id: campaignId,
  title: "Synthetic automated campaign",
  purpose: "marketing",
  templateKey: "workspace",
  delivery: "automated",
  status: "draft",
  audienceId: null,
  locales: ["en-US"],
  createdAt: "2026-10-19T08:00:00Z",
  updatedAt: "2026-10-19T08:00:00Z",
  content: {},
});

const condition: FlowStepValue = {
  _tag: "Condition",
  id: "condition-1",
  filter: { _tag: "Group", operator: "and", filters: [] },
};
const wait: FlowStepValue = {
  _tag: "Wait",
  id: "wait-1",
  wait: { _tag: "Duration", count: 2, unit: "hour" },
};
const laterWait: FlowStepValue = {
  _tag: "Wait",
  id: "wait-2",
  wait: { _tag: "Duration", count: 3, unit: "day" },
};
const send: FlowStepValue = { _tag: "Send", id: "send" };

const savedSteps = () =>
  campaignOperationInputs("updateAutomationFlow").map(
    (input) => (input as { flow: { steps: unknown } }).flow.steps
  );

const renderBuilder = (steps: readonly FlowStepValue[]) => {
  const automation = Schema.decodeUnknownSync(AutomationDetail)({
    campaignId,
    status: "draft",
    flow: { trigger: { _tag: "ReservationFinished" }, steps },
    trigger: {
      kind: "reservation-finished",
      frequency: { maxFiresPerHour: 1, firesMoreThanHourly: false },
    },
    activeVersion: null,
    versionCount: 0,
    pendingChanges: false,
    activation: { _tag: "PreviewRequired" },
    updatedAt: "2026-10-19T08:00:00Z",
  });
  const view = render(
    <RouteLocaleProvider locale={locale}>
      <AutomationFlowBuilder
        campaign={campaign}
        automation={automation}
        data={{ lookups: {}, savedAudiences: [], calendarPreviews: {} }}
      />
    </RouteLocaleProvider>
  );
  const stepMenuName = (step: FlowStepValue, number: number) =>
    m.emailAutomationFlowStepMenuLabel(
      { step: stepLabel(step, number, locale) },
      { locale }
    );
  const stepMenu = (step: FlowStepValue, number: number) =>
    view.queryByRole("button", { name: stepMenuName(step, number) });
  const insertPoint = (position: number) =>
    view.queryByRole("button", {
      name: m.emailAutomationFlowInsertLabel({ position }, { locale }),
    });
  /** The open menu's item whose name starts with `label`; some add a hint. */
  const menuItem = (label: string) =>
    within(view.getByRole("menu")).getByRole("menuitem", {
      name: (name) => name.startsWith(label),
    });
  const select = (item: HTMLElement) =>
    act(() => {
      fireEvent.click(item);
    });
  const save = () =>
    act(async () => {
      fireEvent.click(
        view.getByRole("button", {
          name: m.emailAutomationFlowSave({}, { locale }),
        })
      );
    });
  return { view, stepMenu, insertPoint, menuItem, select, save };
};

const isDisabled = (item: HTMLElement) =>
  item.getAttribute("aria-disabled") === "true";

describe("insert points", () => {
  test("sit before every step, the send included, and never after it", () => {
    const { insertPoint } = renderBuilder([condition, wait, send]);

    expect([1, 2, 3].map((position) => insertPoint(position) !== null)).toEqual(
      [true, true, true]
    );
    expect(insertPoint(4)).toBeNull();
  });

  test("offer a condition and a wait, never a send", async () => {
    const onInsert = mock((_kind: string) => undefined);
    const view = render(
      <RouteLocaleProvider locale={locale}>
        <InsertStepMenu position={1} onInsert={onInsert} />
      </RouteLocaleProvider>
    );
    const trigger = view.getByRole("button");

    await openMenu(trigger);
    const items = view.getAllByRole("menuitem");
    expect(items).toHaveLength(2);
    for (const index of [0, 1]) {
      if (index > 0) await openMenu(trigger);
      act(() => {
        fireEvent.click(view.getAllByRole("menuitem")[index] as HTMLElement);
      });
    }

    expect(onInsert.mock.calls.map(([kind]) => kind).sort()).toEqual([
      "Condition",
      "Wait",
    ]);
  });

  test("insert the chosen step at their position", async () => {
    const { stepMenu, insertPoint, menuItem, select } = renderBuilder([
      wait,
      send,
    ]);

    await openMenu(insertPoint(1) as HTMLElement);
    select(menuItem(m.emailAutomationFlowInsertCondition({}, { locale })));

    expect(stepMenu(condition, 1)).not.toBeNull();
    expect(stepMenu(wait, 2)).not.toBeNull();
    expect(insertPoint(3)).not.toBeNull();
  });
});

describe("step menus", () => {
  test("belong to condition and wait steps, not the send", () => {
    const { stepMenu } = renderBuilder([condition, wait, send]);

    expect(stepMenu(condition, 1)).not.toBeNull();
    expect(stepMenu(wait, 2)).not.toBeNull();
    expect(stepMenu(send, 3)).toBeNull();
  });

  test("can't move the first step up", async () => {
    const { stepMenu, menuItem } = renderBuilder([condition, wait, send]);

    await openMenu(stepMenu(condition, 1) as HTMLElement);

    expect(
      isDisabled(menuItem(m.emailAutomationFlowStepMoveUp({}, { locale })))
    ).toBe(true);
    expect(
      isDisabled(menuItem(m.emailAutomationFlowStepMoveDown({}, { locale })))
    ).toBe(false);
    expect(
      isDisabled(menuItem(m.emailAutomationFlowStepDelete({}, { locale })))
    ).toBe(false);
  });

  test("can't move the step before the send past it", async () => {
    const { stepMenu, menuItem } = renderBuilder([condition, wait, send]);

    await openMenu(stepMenu(wait, 2) as HTMLElement);

    expect(
      isDisabled(menuItem(m.emailAutomationFlowStepMoveUp({}, { locale })))
    ).toBe(false);
    expect(
      isDisabled(menuItem(m.emailAutomationFlowStepMoveDown({}, { locale })))
    ).toBe(true);
  });

  test("can't move a lone step either way", async () => {
    const { stepMenu, menuItem } = renderBuilder([wait, send]);

    await openMenu(stepMenu(wait, 1) as HTMLElement);

    expect(
      isDisabled(menuItem(m.emailAutomationFlowStepMoveUp({}, { locale })))
    ).toBe(true);
    expect(
      isDisabled(menuItem(m.emailAutomationFlowStepMoveDown({}, { locale })))
    ).toBe(true);
  });

  test("move a step down", async () => {
    const { stepMenu, menuItem, select } = renderBuilder([
      condition,
      wait,
      send,
    ]);

    await openMenu(stepMenu(condition, 1) as HTMLElement);
    select(menuItem(m.emailAutomationFlowStepMoveDown({}, { locale })));

    expect(stepMenu(wait, 1)).not.toBeNull();
    expect(stepMenu(condition, 2)).not.toBeNull();
  });

  test("delete a step", async () => {
    const { stepMenu, insertPoint, menuItem, select } = renderBuilder([
      condition,
      wait,
      send,
    ]);

    await openMenu(stepMenu(condition, 1) as HTMLElement);
    select(menuItem(m.emailAutomationFlowStepDelete({}, { locale })));

    expect(stepMenu(wait, 1)).not.toBeNull();
    expect(stepMenu(condition, 1)).toBeNull();
    expect(insertPoint(3)).toBeNull();
  });

  test("save a wait moved up before the send", async () => {
    const { stepMenu, menuItem, select, save } = renderBuilder([
      wait,
      laterWait,
      send,
    ]);

    await openMenu(stepMenu(laterWait, 2) as HTMLElement);
    select(menuItem(m.emailAutomationFlowStepMoveUp({}, { locale })));
    await save();

    expect(savedSteps()).toEqual([[laterWait, wait, send]]);
  });

  test("save without a deleted wait, the send still last", async () => {
    const { stepMenu, menuItem, select, save } = renderBuilder([
      wait,
      laterWait,
      send,
    ]);

    await openMenu(stepMenu(laterWait, 2) as HTMLElement);
    select(menuItem(m.emailAutomationFlowStepDelete({}, { locale })));
    await save();

    expect(savedSteps()).toEqual([[wait, send]]);
  });
});

test("switching the trigger saves the steps unchanged", async () => {
  const steps = [wait, send];
  const { view, save } = renderBuilder(steps);

  act(() => {
    fireEvent.click(
      view
        .getAllByRole("radio")
        .find(
          (radio) => radio.getAttribute("value") === "schedule"
        ) as HTMLElement
    );
  });
  await save();

  expect(campaignOperationInputs("updateAutomationFlow")).toEqual([
    {
      campaignId,
      flow: {
        trigger: { _tag: "Schedule", calendar: defaultScheduleCalendar },
        steps,
      },
    },
  ]);
});

test("lock the flow while a save is in flight", () => {
  workspaceUseAction.mockImplementation(
    () => ({ execute: mock(), isExecuting: true }) as never
  );
  const { view } = renderBuilder([wait, send]);

  expect(view.container.querySelector("fieldset")?.disabled).toBe(true);
});

test("leave the flow editable when no save is in flight", () => {
  const { view } = renderBuilder([wait, send]);

  expect(view.container.querySelector("fieldset")?.disabled).toBe(false);
});
