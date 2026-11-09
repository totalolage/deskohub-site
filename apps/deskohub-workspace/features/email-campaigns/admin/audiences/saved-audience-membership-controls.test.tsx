import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import {
  AdministrationCampaignAudienceId,
  type InSavedAudienceType as InSavedAudience,
} from "@deskohub/workspace-admin-api";
import { m } from "@/features/administration/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { AudienceValueOption } from "../audience-filter-summary";
import { newSavedAudienceMembership } from "./audience-filter-editing";

registerWorkspaceComponentTestEnv();
// @testing-library/react must load after the happy-dom registration.
const { act, cleanup, fireEvent, render } = await import(
  "@testing-library/react"
);
const { SavedAudienceMembershipControls } = await import(
  "./saved-audience-membership-controls"
);

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

const locale = "en-US";

const savedAudiences: readonly AudienceValueOption[] = [
  { id: "01970000-0000-7000-8000-0000000000a1", name: "Regular coworkers" },
  { id: "01970000-0000-7000-8000-0000000000a2", name: "Meeting room bookers" },
];

const deletedAudienceId = AdministrationCampaignAudienceId.make(
  "01970000-0000-7000-8000-0000000000ff"
);

const membershipOf = (
  audienceId: string,
  operator: InSavedAudience["operator"] = "in"
): InSavedAudience => ({
  ...newSavedAudienceMembership(),
  operator,
  audienceId: AdministrationCampaignAudienceId.make(audienceId),
});

const renderControls = (
  condition: InSavedAudience,
  onChange: (condition: InSavedAudience) => void = () => undefined,
  errorAt: (field: string) => string | undefined = () => undefined
) =>
  render(
    <RouteLocaleProvider locale={locale}>
      <SavedAudienceMembershipControls
        value={condition}
        onChange={onChange}
        errorAt={errorAt}
        savedAudiences={savedAudiences}
      />
    </RouteLocaleProvider>
  );

type View = ReturnType<typeof renderControls>;

const picker = (view: View) =>
  view.getByRole("combobox", {
    name: m.emailAutomationFlowSavedAudiencePickerLabel({}, { locale }),
  });

const operatorSelect = (view: View) =>
  view.getByRole("combobox", {
    name: m.emailAutomationFlowSavedAudienceOperatorLabel({}, { locale }),
  });

const openPicker = async (view: View) => {
  await act(async () => {
    fireEvent.click(picker(view));
  });
};

/** Whether an option shows the chosen check mark. */
const checked = (option: HTMLElement | undefined) =>
  option?.querySelector("svg") !== null;

const unknownLabel = m.emailAutomationFlowSavedAudienceUnknown({}, { locale });

describe("SavedAudienceMembershipControls", () => {
  test("shows the placeholder until an audience is chosen", () => {
    const view = renderControls(newSavedAudienceMembership());
    expect(picker(view).textContent).toBe(
      m.emailAutomationFlowSavedAudiencePickerPlaceholder({}, { locale })
    );
  });

  test("names the chosen audience on the picker and selects its option", async () => {
    const view = renderControls(membershipOf(savedAudiences[1]?.id ?? ""));
    expect(picker(view).textContent).toBe("Meeting room bookers");
    await openPicker(view);
    const options = view.getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(
      savedAudiences.map(({ name }) => name)
    );
    expect(options.map(checked)).toEqual([false, true]);
  });

  test("keeps a deleted audience chosen under the unknown label", async () => {
    const onChange = mock((_condition: InSavedAudience) => undefined);
    const view = renderControls(membershipOf(deletedAudienceId), onChange);
    expect(picker(view).textContent).toBe(unknownLabel);
    await openPicker(view);
    const options = view.getAllByRole("option");
    expect(options).toHaveLength(savedAudiences.length + 1);
    expect(options[0]?.textContent).toBe(unknownLabel);
    expect(options.map(checked)).toEqual([true, false, false]);

    await act(async () => {
      fireEvent.click(view.getByRole("option", { name: unknownLabel }));
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(picker(view).getAttribute("aria-expanded")).toBe("false");
  });

  test("picking an audience replaces the deleted one and closes the picker", async () => {
    const onChange = mock((_condition: InSavedAudience) => undefined);
    const view = renderControls(
      membershipOf(deletedAudienceId, "notIn"),
      onChange
    );
    await openPicker(view);
    expect(picker(view).getAttribute("aria-expanded")).toBe("true");
    await act(async () => {
      fireEvent.click(view.getByRole("option", { name: "Regular coworkers" }));
    });
    expect(onChange.mock.calls).toEqual([
      [membershipOf(savedAudiences[0]?.id ?? "", "notIn")],
    ]);
    expect(picker(view).getAttribute("aria-expanded")).toBe("false");
  });

  test("switches the operator and keeps the chosen audience", async () => {
    const onChange = mock((_condition: InSavedAudience) => undefined);
    const condition = membershipOf(savedAudiences[0]?.id ?? "");
    const view = renderControls(condition, onChange);
    await act(async () => {
      fireEvent.keyDown(operatorSelect(view), { key: "Enter" });
    });
    await act(async () => {
      fireEvent.click(
        view.getByRole("option", {
          name: m.emailAutomationFlowSavedAudienceOperator(
            { operator: "notIn" },
            { locale }
          ),
        })
      );
    });
    expect(onChange.mock.calls).toEqual([
      [{ ...condition, operator: "notIn" }],
    ]);
  });

  test("points the picker at the required-audience error", () => {
    const view = renderControls(
      newSavedAudienceMembership(),
      undefined,
      (field) => (field === "audienceId" ? "required" : undefined)
    );
    expect(picker(view).getAttribute("aria-invalid")).toBe("true");
    const alert = document.getElementById(
      picker(view).getAttribute("aria-describedby") ?? ""
    );
    expect(alert?.textContent).toBe(
      m.emailAutomationFlowSavedAudienceRequired({}, { locale })
    );
  });
});
