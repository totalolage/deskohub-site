import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import {
  AdministrationCampaignId,
  audienceAttributeCatalogue,
} from "@deskohub/workspace-admin-api";
import { Result, Schema } from "effect";
import type { Locale } from "@/features/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import {
  type AudienceCondition,
  audienceFilterSchema,
} from "../../audience-filter";
import type { AudienceCampaignOption } from "../audience-filter-summary";
import {
  type AudienceCountWording,
  audienceAttributeWording,
} from "./audience-attribute-wording";
import { newCondition } from "./audience-filter-editing";

registerWorkspaceComponentTestEnv();
// @testing-library/react must load after the happy-dom registration.
const { act, cleanup, fireEvent, render, within } = await import(
  "@testing-library/react"
);
const { CountConditionControls } = await import(
  "./audience-condition-controls"
);

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

/** The form's lookup: each issue's message at its path below the condition. */
const formErrors = (input: AudienceCondition) => {
  const result =
    Schema.toStandardSchemaV1(audienceFilterSchema)["~standard"].validate(
      input
    );
  const issues = "issues" in result ? (result.issues ?? []) : [];
  return (field: string) =>
    issues.find(({ path }) => (path ?? []).join(".") === field)?.message;
};

const campaignEmailCountWording = (locale: Locale) =>
  audienceAttributeWording(
    "campaignEmailCount",
    locale
  ) as AudienceCountWording;

describe("CountConditionControls", () => {
  test.each([
    ["en-US", "lt", "“< 0” never matches. Use “= 0” for none."],
    [
      "en-US",
      "gte",
      "“≥ 0” always matches. Use “≥ 1” for any, or remove the condition.",
    ],
    ["cs-CZ", "lt", "„< 0“ nevyhovuje nikdy. Pro žádné použijte „= 0“."],
  ] as const)(
    "explains in %s why “%s 0” is rejected",
    (locale, operator, message) => {
      const condition = {
        ...newCondition("campaignEmailCount"),
        operator,
        value: 0,
      } as const;
      expect(
        Result.isFailure(
          Schema.decodeUnknownResult(audienceFilterSchema)(condition)
        )
      ).toBe(true);
      const view = render(
        <RouteLocaleProvider locale={locale}>
          <CountConditionControls
            entry={audienceAttributeCatalogue.campaignEmailCount}
            wording={campaignEmailCountWording(locale)}
            value={condition}
            onChange={() => undefined}
            errorAt={formErrors(condition)}
            lookups={{}}
          />
        </RouteLocaleProvider>
      );
      expect(view.getByRole("alert").textContent).toBe(message);
    }
  );
});

const springSaleId = AdministrationCampaignId.make(
  "01970000-0000-7000-8000-000000000001"
);

const campaigns: readonly AudienceCampaignOption[] = [
  {
    id: springSaleId,
    name: "Spring sale 2026",
    delivery: "once",
    status: "sent",
  },
  {
    id: "01970000-0000-7000-8000-000000000002",
    name: "Jarní výprodej",
    delivery: "once",
    status: "draft",
  },
  {
    id: "01970000-0000-7000-8000-000000000003",
    name: "Welcome series",
    delivery: "automated",
    status: "active",
  },
];

const renderCampaignEmailCount = (
  condition: AudienceCondition & { readonly attribute: "campaignEmailCount" },
  onChange: (condition: AudienceCondition) => void = () => undefined,
  locale: Locale = "en-US"
) =>
  render(
    <RouteLocaleProvider locale={locale}>
      <CountConditionControls
        entry={audienceAttributeCatalogue.campaignEmailCount}
        wording={campaignEmailCountWording(locale)}
        value={condition}
        onChange={onChange}
        errorAt={() => undefined}
        lookups={{ campaigns }}
      />
    </RouteLocaleProvider>
  );

/** Opens the picker and lets its popover settle into place. */
const openCampaignPicker = async (picker: HTMLElement) => {
  await act(async () => {
    fireEvent.click(picker);
  });
};

describe("campaign picker", () => {
  test("reads “received from” with the purpose before any campaign", () => {
    const view = renderCampaignEmailCount(newCondition("campaignEmailCount"));
    expect(
      view.getByRole("combobox", { name: "Campaign purpose" })
    ).toBeTruthy();
    expect(view.getByText("campaign emails received from")).toBeTruthy();
    expect(view.getByRole("combobox", { name: "Campaign" }).textContent).toBe(
      "any campaign"
    );
  });

  test("hides the purpose once a campaign is picked", () => {
    const view = renderCampaignEmailCount({
      ...newCondition("campaignEmailCount"),
      params: {
        purpose: "any",
        period: { _tag: "Past" },
        campaign: { _tag: "Specific", campaignId: springSaleId },
      },
    });
    expect(
      view.queryByRole("combobox", { name: "Campaign purpose" })
    ).toBeNull();
    expect(view.getByRole("combobox", { name: "Campaign" }).textContent).toBe(
      "Spring sale 2026"
    );
  });

  test("lists “any campaign” first, badges each campaign, and searches by name", async () => {
    const view = renderCampaignEmailCount(newCondition("campaignEmailCount"));
    await openCampaignPicker(view.getByRole("combobox", { name: "Campaign" }));
    const options = () =>
      view.getAllByRole("option").map((option) => option.textContent);
    expect(options()).toEqual([
      "any campaign",
      "Spring sale 2026Sent",
      "Jarní výprodejDraft",
      "Welcome seriesAutomated",
    ]);
    fireEvent.change(view.getByPlaceholderText("Search campaigns"), {
      target: { value: "VYPRODEJ" },
    });
    expect(options()).toEqual(["Jarní výprodejDraft"]);
    fireEvent.change(view.getByPlaceholderText("Search campaigns"), {
      target: { value: "autumn" },
    });
    expect(view.queryAllByRole("option")).toEqual([]);
    expect(view.getByText("No campaign matches.")).toBeTruthy();
  });

  test("picking a campaign counts its emails whatever their purpose", async () => {
    const onChange = mock((_condition: AudienceCondition) => undefined);
    const view = renderCampaignEmailCount(
      newCondition("campaignEmailCount"),
      onChange
    );
    await openCampaignPicker(view.getByRole("combobox", { name: "Campaign" }));
    fireEvent.click(view.getByRole("option", { name: /Spring sale 2026/ }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({
      params: {
        purpose: "any",
        campaign: { _tag: "Specific", campaignId: springSaleId },
      },
    });
    expect(view.queryByRole("listbox")).toBeNull();
  });

  test("reads naturally in Czech", async () => {
    const view = renderCampaignEmailCount(
      newCondition("campaignEmailCount"),
      undefined,
      "cs-CZ"
    );
    expect(view.getByText("e-mailů, které zákazník obdržel z")).toBeTruthy();
    const picker = view.getByRole("combobox", { name: "Kampaň" });
    expect(picker.textContent).toBe("libovolné kampaně");
    await openCampaignPicker(picker);
    const automated = view.getByRole("option", { name: /Welcome series/ });
    expect(within(automated).getByText("Automatická")).toBeTruthy();
  });
});

describe("DatePeriodControl", () => {
  test("shows a stored “any time so far” period", () => {
    const view = renderCampaignEmailCount({
      ...newCondition("campaignEmailCount"),
      params: { purpose: "marketing", period: { _tag: "Past" } },
    });
    expect(
      view.getByRole("combobox", { name: "Emails received period" }).textContent
    ).toBe("any time so far");
  });

  test.each([
    [1, "za poslední", "den"],
    [3, "za poslední", "dny"],
    [30, "za posledních", "dní"],
  ] as const)("reads “in the last %d days” in Czech", (count, lead, unit) => {
    const condition = {
      ...newCondition("campaignEmailCount"),
      params: {
        purpose: "marketing",
        period: { _tag: "Last", count, unit: "day" },
      },
    } as const;
    const view = render(
      <RouteLocaleProvider locale="cs-CZ">
        <CountConditionControls
          entry={audienceAttributeCatalogue.campaignEmailCount}
          wording={campaignEmailCountWording("cs-CZ")}
          value={condition}
          onChange={() => undefined}
          errorAt={() => undefined}
          lookups={{}}
        />
      </RouteLocaleProvider>
    );
    const trigger = (name: string) =>
      view.getByRole("combobox", { name }).textContent;
    expect(trigger("Přijaté e-maily: období")).toBe(lead);
    expect(trigger("Přijaté e-maily: jednotka období")).toBe(unit);
  });
});
