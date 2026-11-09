import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import type {
  AudienceFilterGroupOf,
  AutomationConditionLeaf,
} from "@deskohub/workspace-admin-api";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { m } from "@/features/administration/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { AudienceValueOption } from "../audience-filter-summary";
import { automationFlowFormErrors } from "../automation/builder/automation-flow-form.test-utils";
import {
  type AudienceBooleanWording,
  type AudienceCountWording,
  type AudienceDateWording,
  type AudienceSetWording,
  audienceAttributeWording,
} from "./audience-attribute-wording";
import type { FilterErrorLookup } from "./audience-filter-builder";
import {
  type AudienceFilterGroup,
  newCondition,
  newSavedAudienceMembership,
  unchosenSavedAudience,
} from "./audience-filter-editing";

beforeAll(registerWorkspaceComponentTestEnv);
afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

type ConditionGroup = AudienceFilterGroupOf<AutomationConditionLeaf>;

const conditionPath = "steps.0.filter";

const savedAudiences: readonly AudienceValueOption[] = [
  { id: "01970000-0000-7000-8000-0000000000a1", name: "Regular coworkers" },
  { id: "01970000-0000-7000-8000-0000000000a2", name: "Meeting room bookers" },
];

const emptyGroup: AudienceFilterGroup = {
  _tag: "Group",
  operator: "and",
  filters: [],
};

const groupOf = (...filters: ConditionGroup["filters"]): ConditionGroup => ({
  _tag: "Group",
  operator: "and",
  filters,
});

/** The flow form's errors for a condition step holding `filter`. */
const conditionErrors = async (
  filter: ConditionGroup
): Promise<FilterErrorLookup> => {
  const errors = await automationFlowFormErrors({
    trigger: { _tag: "AccountCreated" },
    steps: [
      { _tag: "Condition", id: "condition-1", filter },
      { _tag: "Send", id: "send" },
    ],
  });
  return errors.at;
};

const renderSavedAudienceBuilder = async () => {
  const { AudienceFilterBuilder } = await import("./audience-filter-builder");
  return render(
    <RouteLocaleProvider locale="en-US">
      <AudienceFilterBuilder
        path="filter"
        value={emptyGroup}
        onChange={() => undefined}
        errorAt={() => undefined}
      />
    </RouteLocaleProvider>
  );
};

const renderConditionBuilder = async (
  value: ConditionGroup,
  onChange: (value: ConditionGroup) => void = () => undefined
) => {
  const { AudienceFilterBuilder } = await import("./audience-filter-builder");
  const errorAt = await conditionErrors(value);
  return render(
    <RouteLocaleProvider locale="en-US">
      <AudienceFilterBuilder
        holder="automation-condition"
        path={conditionPath}
        value={value}
        onChange={onChange}
        errorAt={errorAt}
        savedAudiences={savedAudiences}
      />
    </RouteLocaleProvider>
  );
};

type BuilderView = Awaited<ReturnType<typeof renderConditionBuilder>>;

/** Opens the "add condition" menu and returns its items. */
const addConditionMenu = async (view: BuilderView) => {
  await act(async () => {
    fireEvent.keyDown(
      view.getByRole("button", {
        name: m.emailCampaignsAudienceGroupAddCondition(
          {},
          { locale: "en-US" }
        ),
      }),
      { key: "Enter" }
    );
  });
  return view.getAllByRole("menuitem");
};

const membershipMenuItemName = m.emailAutomationFlowSavedAudienceMenuLabel(
  {},
  { locale: "en-US" }
);

const audiencePicker = (view: BuilderView) =>
  view.getByRole("combobox", {
    name: m.emailAutomationFlowSavedAudiencePickerLabel(
      {},
      { locale: "en-US" }
    ),
  });

test("offers saved-audience membership only in an automation condition", async () => {
  const savedAudience = await renderSavedAudienceBuilder();
  const savedAudienceItems = await addConditionMenu(savedAudience);
  expect(savedAudienceItems.length).toBeGreaterThan(0);
  expect(
    savedAudience.queryByRole("menuitem", { name: membershipMenuItemName })
  ).toBeNull();
  cleanup();

  const condition = await renderConditionBuilder(groupOf());
  const conditionItems = await addConditionMenu(condition);
  expect(conditionItems).toHaveLength(savedAudienceItems.length + 1);
  expect(
    condition.getByRole("menuitem", { name: membershipMenuItemName })
  ).toBeTruthy();
});

test("adds a membership leaf with no audience chosen yet", async () => {
  const onChange = mock((_value: ConditionGroup) => undefined);
  const view = await renderConditionBuilder(groupOf(), onChange);
  await addConditionMenu(view);
  await act(async () => {
    fireEvent.click(
      view.getByRole("menuitem", { name: membershipMenuItemName })
    );
  });
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange.mock.calls[0]?.[0]).toEqual(
    groupOf({
      _tag: "InAudience",
      operator: "in",
      audienceId: unchosenSavedAudience,
    })
  );
});

test("marks the audience picker invalid until an audience is chosen", async () => {
  const unchosen = await renderConditionBuilder(
    groupOf(newSavedAudienceMembership())
  );
  const picker = audiencePicker(unchosen);
  expect(picker.getAttribute("aria-invalid")).toBe("true");
  const error = document.getElementById(
    picker.getAttribute("aria-describedby") ?? ""
  );
  expect(error?.getAttribute("role")).toBe("alert");
  expect(error?.textContent).not.toBe("");
  cleanup();

  const chosen = await renderConditionBuilder(
    groupOf({
      ...newSavedAudienceMembership(),
      audienceId: savedAudiences[0]?.id ?? "",
    } as AutomationConditionLeaf)
  );
  expect(audiencePicker(chosen).getAttribute("aria-invalid")).toBe("false");
  expect(audiencePicker(chosen).hasAttribute("aria-describedby")).toBe(false);
  // The alerts stay mounted, empty, so a later error is announced.
  expect(
    chosen.getAllByRole("alert").filter((alert) => alert.textContent !== "")
  ).toHaveLength(0);
});

test("choosing an audience sets the leaf's audience and keeps its operator", async () => {
  const onChange = mock((_value: ConditionGroup) => undefined);
  const view = await renderConditionBuilder(
    groupOf({ ...newSavedAudienceMembership(), operator: "notIn" }),
    onChange
  );
  await act(async () => {
    fireEvent.click(audiencePicker(view));
  });
  expect(view.getAllByRole("option")).toHaveLength(savedAudiences.length);
  await act(async () => {
    fireEvent.click(view.getByRole("option", { name: "Meeting room bookers" }));
  });
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange.mock.calls[0]?.[0]).toEqual(
    groupOf({
      _tag: "InAudience",
      operator: "notIn",
      audienceId: savedAudiences[1]?.id,
    } as AutomationConditionLeaf)
  );
});

const savedAudienceGroupOf = (
  ...filters: AudienceFilterGroup["filters"]
): AudienceFilterGroup => ({ _tag: "Group", operator: "and", filters });

const renderSavedAudienceFilter = async (
  value: AudienceFilterGroup,
  onChange: (value: AudienceFilterGroup) => void = () => undefined
) => {
  const { AudienceFilterBuilder } = await import("./audience-filter-builder");
  return render(
    <RouteLocaleProvider locale="en-US">
      <AudienceFilterBuilder
        path="filter"
        value={value}
        onChange={onChange}
        errorAt={() => undefined}
      />
    </RouteLocaleProvider>
  );
};

const leafPickers = (view: BuilderView) =>
  view.getAllByRole("combobox", {
    name: m.emailCampaignsAudienceConditionAttributeLabel(
      {},
      { locale: "en-US" }
    ),
  });

const countWording = audienceAttributeWording(
  "campaignEmailCount",
  "en-US"
) as AudienceCountWording;
const dateWording = audienceAttributeWording(
  "accountCreated",
  "en-US"
) as AudienceDateWording;
const setWording = audienceAttributeWording(
  "locale",
  "en-US"
) as AudienceSetWording;
const booleanWording = audienceAttributeWording(
  "hasAccount",
  "en-US"
) as AudienceBooleanWording;

test("renders each condition with its attribute kind's controls", async () => {
  const view = await renderSavedAudienceFilter(
    savedAudienceGroupOf(
      newCondition("campaignEmailCount"),
      newCondition("accountCreated"),
      newCondition("locale"),
      newCondition("hasAccount")
    )
  );
  expect(leafPickers(view).map((picker) => picker.textContent)).toEqual([
    countWording.label,
    dateWording.label,
    setWording.label,
    booleanWording.label,
  ]);
  const comboboxNamed = (name: string) =>
    view.getAllByRole("combobox", { name });
  expect(
    comboboxNamed(
      m.emailCampaignsAudienceCountComparisonLabel(
        { subject: countWording.count },
        { locale: "en-US" }
      )
    )
  ).toHaveLength(1);
  expect(
    comboboxNamed(
      m.emailCampaignsAudienceDateConditionLabel(
        { subject: dateWording.label },
        { locale: "en-US" }
      )
    )
  ).toHaveLength(1);
  expect(
    comboboxNamed(
      m.emailCampaignsAudienceSetMatchLabel(
        { subject: setWording.label },
        { locale: "en-US" }
      )
    )
  ).toHaveLength(1);
  expect(
    view.getAllByRole("radio", { name: booleanWording.true })
  ).toHaveLength(1);
});

test("hands a condition's edit back at its place in the group", async () => {
  const onChange = mock((_value: AudienceFilterGroup) => undefined);
  const count = newCondition("campaignEmailCount");
  const hasAccount = newCondition("hasAccount");
  const view = await renderSavedAudienceFilter(
    savedAudienceGroupOf(count, hasAccount),
    onChange
  );
  await act(async () => {
    fireEvent.click(view.getByRole("radio", { name: booleanWording.false }));
  });
  expect(onChange.mock.calls).toEqual([
    [savedAudienceGroupOf(count, { ...hasAccount, value: false })],
  ]);
});

test("switching a condition's attribute starts it over from that attribute's defaults", async () => {
  const onChange = mock((_value: AudienceFilterGroup) => undefined);
  const hasAccount = newCondition("hasAccount");
  const view = await renderSavedAudienceFilter(
    savedAudienceGroupOf(newCondition("campaignEmailCount"), hasAccount),
    onChange
  );
  await act(async () => {
    fireEvent.keyDown(leafPickers(view)[0] as HTMLElement, { key: "Enter" });
  });
  await act(async () => {
    fireEvent.click(view.getByRole("option", { name: setWording.label }));
  });
  expect(onChange.mock.calls).toEqual([
    [savedAudienceGroupOf(newCondition("locale"), hasAccount)],
  ]);
});
