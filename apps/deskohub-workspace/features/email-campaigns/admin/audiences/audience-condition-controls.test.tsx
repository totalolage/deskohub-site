import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import {
  AdministrationCampaignId,
  audienceAttributeCatalogue,
} from "@deskohub/workspace-admin-api";
import { Result, Schema } from "effect";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import { coworkReservationKind } from "@/features/reservation/reservation-kind";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import {
  type AudienceCondition,
  audienceFilterSchema,
} from "../../audience-filter";
import type { AudienceFilterHolder } from "../../audience-filter-usage";
import type {
  AudienceCampaignOption,
  AudienceValueLookups,
} from "../audience-filter-summary";
import {
  type AudienceCountWording,
  type AudienceDateWording,
  type AudienceSetWording,
  audienceAttributeWording,
} from "./audience-attribute-wording";
import { newCondition } from "./audience-filter-editing";
import { reservationProductFamilyLabel } from "./reservation-product-wording";

registerWorkspaceComponentTestEnv();
// @testing-library/react must load after the happy-dom registration.
const { act, cleanup, fireEvent, render, within } = await import(
  "@testing-library/react"
);
const { CountConditionControls, DateConditionControls, SetConditionControls } =
  await import("./audience-condition-controls");

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
      const alert = view.getByRole("alert");
      expect(alert.textContent).toBe(message);
      const invalid = view.container.querySelectorAll('[aria-invalid="true"]');
      expect(invalid.length).toBeGreaterThan(0);
      for (const control of invalid) {
        expect(control.getAttribute("aria-describedby")).toBe(alert.id);
      }
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
    fireEvent.change(view.getByRole("combobox", { name: "Search campaigns" }), {
      target: { value: "VYPRODEJ" },
    });
    expect(options()).toEqual(["Jarní výprodejDraft"]);
  });

  test.each([
    ["en-US", "Campaign", "Search campaigns", "No campaign matches."],
    ["cs-CZ", "Kampaň", "Hledat kampaně", "Žádná kampaň neodpovídá."],
  ] as const)(
    "names the search and announces no matches in %s",
    async (locale, pickerName, searchName, emptyMessage) => {
      const view = renderCampaignEmailCount(
        newCondition("campaignEmailCount"),
        undefined,
        locale
      );
      await openCampaignPicker(
        view.getByRole("combobox", { name: pickerName })
      );
      const status = view.getByRole("status");
      expect(status.textContent).toBe("");
      fireEvent.change(view.getByRole("combobox", { name: searchName }), {
        target: { value: "autumn" },
      });
      expect(view.queryAllByRole("option")).toEqual([]);
      expect(view.getByRole("status")).toBe(status);
      expect(status.textContent).toBe(emptyMessage);
    }
  );

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

describe("campaign picker by holder", () => {
  const thisCampaignName = m.emailAutomationFlowCampaignSourceThis(
    {},
    { locale: "en-US" }
  );

  const renderFor = (
    holder: AudienceFilterHolder,
    onChange: (condition: AudienceCondition) => void = () => undefined
  ) =>
    render(
      <RouteLocaleProvider locale="en-US">
        <CountConditionControls
          entry={audienceAttributeCatalogue.campaignEmailCount}
          wording={campaignEmailCountWording("en-US")}
          value={newCondition("campaignEmailCount")}
          onChange={onChange}
          errorAt={() => undefined}
          lookups={{ campaigns }}
          holder={holder}
        />
      </RouteLocaleProvider>
    );

  test.each([
    ["saved-audience", campaigns.length + 1, false],
    ["automation-condition", campaigns.length + 2, true],
  ] as const)(
    "offers “this campaign” to a %s only where it can hold it",
    async (holder, optionCount, offersThisCampaign) => {
      const view = renderFor(holder);
      await openCampaignPicker(
        view.getByRole("combobox", { name: "Campaign" })
      );
      expect(view.getAllByRole("option")).toHaveLength(optionCount);
      expect(
        view.queryByRole("option", { name: thisCampaignName }) !== null
      ).toBe(offersThisCampaign);
    }
  );

  test("picking “this campaign” counts the automation's own emails", async () => {
    const onChange = mock((_condition: AudienceCondition) => undefined);
    const view = renderFor("automation-condition", onChange);
    await openCampaignPicker(view.getByRole("combobox", { name: "Campaign" }));
    fireEvent.click(view.getByRole("option", { name: thisCampaignName }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({
      params: { purpose: "any", campaign: { _tag: "This" } },
    });
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

type View = ReturnType<typeof render>;

/** Opens a select and picks the option of that name. */
const choose = async (view: View, select: string, option: string) => {
  await act(async () => {
    fireEvent.keyDown(view.getByRole("combobox", { name: select }), {
      key: "Enter",
    });
  });
  await act(async () => {
    fireEvent.click(view.getByRole("option", { name: option }));
  });
};

/** The first condition each change handler call received. */
const changed = (onChange: ReturnType<typeof mock>) =>
  onChange.mock.calls[0]?.[0];

describe("campaign picker with a chosen campaign", () => {
  const sourceWording =
    campaignEmailCountWording("en-US").campaignSources?.campaign;
  const specific = (campaignId: string) =>
    ({
      ...newCondition("campaignEmailCount"),
      params: {
        purpose: "any",
        period: { _tag: "Past" },
        campaign: {
          _tag: "Specific",
          campaignId: AdministrationCampaignId.make(campaignId),
        },
      },
    }) as const;

  test("keeps a campaign missing from the list chosen under its unknown label", async () => {
    const onChange = mock((_condition: AudienceCondition) => undefined);
    const view = renderCampaignEmailCount(
      specific("01970000-0000-7000-8000-0000000000ff"),
      onChange
    );
    const picker = view.getByRole("combobox", { name: sourceWording?.label });
    expect(picker.textContent).toBe(sourceWording?.unknown);
    await openCampaignPicker(picker);
    const options = view.getAllByRole("option");
    expect(options).toHaveLength(campaigns.length + 2);
    expect(options[1]?.textContent).toBe(sourceWording?.unknown);
    fireEvent.click(options[1] as HTMLElement);
    expect(onChange).not.toHaveBeenCalled();
    expect(picker.getAttribute("aria-expanded")).toBe("false");
  });

  test("picking any campaign drops the campaign and keeps the rest", async () => {
    const onChange = mock((_condition: AudienceCondition) => undefined);
    const view = renderCampaignEmailCount(specific(springSaleId), onChange);
    await openCampaignPicker(
      view.getByRole("combobox", { name: sourceWording?.label })
    );
    fireEvent.click(
      view.getByRole("option", { name: sourceWording?.absent ?? "" })
    );
    expect(changed(onChange)).toEqual({
      ...newCondition("campaignEmailCount"),
      params: { purpose: "any", period: { _tag: "Past" } },
    });
  });
});

describe("ChoiceParamControl", () => {
  const wording = audienceAttributeWording(
    "reservationCount",
    "en-US"
  ) as AudienceCountWording;
  const renderReservationCount = (
    condition: AudienceCondition,
    onChange: (condition: AudienceCondition) => void
  ) =>
    render(
      <RouteLocaleProvider locale="en-US">
        <CountConditionControls
          entry={audienceAttributeCatalogue.reservationCount}
          wording={wording}
          value={condition}
          onChange={onChange}
          errorAt={() => undefined}
          lookups={{}}
        />
      </RouteLocaleProvider>
    );
  const status = wording.choices.status;
  const dateBasis = wording.choices.dateBasis;

  test("a toggle picks one of its options", () => {
    const onChange = mock((_condition: AudienceCondition) => undefined);
    const view = renderReservationCount(
      newCondition("reservationCount"),
      onChange
    );
    const group = view.getByRole("group", { name: dateBasis?.label });
    expect(
      within(group)
        .getAllByRole("radio")
        .map((radio) => (radio as HTMLInputElement).checked)
    ).toEqual([true, false, false]);
    fireEvent.click(
      within(group).getByRole("radio", {
        name: dateBasis?.options.booking,
      })
    );
    expect(changed(onChange)).toMatchObject({
      params: { dateBasis: "booking" },
    });
  });

  test("an optional select shows its unset value and sets an option", async () => {
    const onChange = mock((_condition: AudienceCondition) => undefined);
    const view = renderReservationCount(
      newCondition("reservationCount"),
      onChange
    );
    const select = view.getByRole("combobox", { name: status?.label });
    expect(select.textContent).toBe(status?.absent);
    await choose(view, status?.label ?? "", status?.options.cancelled ?? "");
    expect(changed(onChange)).toMatchObject({
      params: { status: "cancelled" },
    });
  });

  test("an optional select unsets its value", async () => {
    const onChange = mock((_condition: AudienceCondition) => undefined);
    const condition = newCondition("reservationCount");
    const view = renderReservationCount(
      {
        ...condition,
        params: { ...condition.params, status: "complete" },
      } as AudienceCondition,
      onChange
    );
    await choose(view, status?.label ?? "", status?.absent ?? "");
    expect(changed(onChange)).toEqual(condition);
  });
});

describe("DateConditionControls", () => {
  const wording = (attribute: "lastVisit" | "accountCreated") =>
    audienceAttributeWording(attribute, "en-US") as AudienceDateWording;
  const { label } = wording("lastVisit");
  const subject = { subject: label };
  const en = { locale: "en-US" } as const;
  const product = { family: coworkReservationKind, properties: [] } as const;

  const renderDate = (
    condition: AudienceCondition,
    {
      onChange = () => undefined,
      errorAt = () => undefined,
      attribute = "lastVisit",
    }: {
      readonly onChange?: (condition: AudienceCondition) => void;
      readonly errorAt?: (field: string) => string | undefined;
      readonly attribute?: "lastVisit" | "accountCreated";
    } = {}
  ) =>
    render(
      <RouteLocaleProvider locale="en-US">
        <DateConditionControls
          entry={audienceAttributeCatalogue[attribute]}
          wording={wording(attribute)}
          value={condition}
          onChange={onChange}
          errorAt={errorAt}
        />
      </RouteLocaleProvider>
    );

  const lastVisit = (
    fields: Partial<
      Extract<AudienceCondition, { readonly attribute: "lastVisit" }>
    > = {}
  ): AudienceCondition =>
    ({ ...newCondition("lastVisit"), ...fields }) as AudienceCondition;
  const range = { _tag: "Range", from: "2026-01-01", to: "2026-02-01" };
  const operatorSelect = m.emailCampaignsAudienceDateConditionLabel(
    subject,
    en
  );
  const periodSelect = m.emailCampaignsAudiencePeriodLabel(subject, en);
  const startLabel = m.emailCampaignsAudiencePeriodStartLabel(subject, en);
  const endLabel = m.emailCampaignsAudiencePeriodEndLabel(subject, en);
  const dateLabel = m.emailCampaignsAudiencePeriodDateLabel(subject, en);

  test("switching to no value drops the period and keeps the product", async () => {
    const onChange = mock((_condition: AudienceCondition) => undefined);
    const view = renderDate(lastVisit({ params: { product } }), { onChange });
    await choose(view, operatorSelect, wording("lastVisit").noValue);
    expect(changed(onChange)).toEqual({
      _tag: "Condition",
      attribute: "lastVisit",
      params: { product },
      operator: "none",
    });
  });

  test("with no value it hides the period and starts “not in” at the last 30 days", async () => {
    const onChange = mock((_condition: AudienceCondition) => undefined);
    const view = renderDate(
      { _tag: "Condition", attribute: "lastVisit", operator: "none" },
      { onChange }
    );
    expect(view.queryByRole("combobox", { name: periodSelect })).toBeNull();
    await choose(
      view,
      operatorSelect,
      m.emailCampaignsAudienceDateNotIn({}, en)
    );
    expect(changed(onChange)).toEqual({
      _tag: "Condition",
      attribute: "lastVisit",
      operator: "notIn",
      value: { _tag: "Last", count: 30, unit: "day" },
    });
  });

  test("switching between “in” and “not in” keeps the period", async () => {
    const onChange = mock((_condition: AudienceCondition) => undefined);
    const view = renderDate(lastVisit({ value: range }), { onChange });
    await choose(
      view,
      operatorSelect,
      m.emailCampaignsAudienceDateNotIn({}, en)
    );
    expect(changed(onChange)).toEqual({
      ...lastVisit(),
      operator: "notIn",
      value: range,
    });
  });

  test("bounds a range's dates by each other and edits its start", () => {
    const onChange = mock((_condition: AudienceCondition) => undefined);
    const view = renderDate(lastVisit({ value: range }), { onChange });
    const start = view.getByLabelText(startLabel);
    const end = view.getByLabelText(endLabel);
    expect(start.getAttribute("max")).toBe(range.to);
    expect(start.getAttribute("min")).toBeNull();
    expect(end.getAttribute("min")).toBe(range.from);
    expect(end.getAttribute("max")).toBeNull();
    expect(view.container.querySelector('[aria-invalid="true"]')).toBeNull();
    fireEvent.change(start, { target: { value: "2026-01-15" } });
    expect(changed(onChange)).toEqual(
      lastVisit({ value: { ...range, from: "2026-01-15" } })
    );
  });

  test("marks both dates of a range out of order", () => {
    const view = renderDate(lastVisit({ value: range }), {
      errorAt: (field) => (field === "value" ? "out of order" : undefined),
    });
    const alert = view.getByRole("alert");
    expect(alert.textContent).toBe(
      m.emailCampaignsAudiencePeriodOrderError({}, en)
    );
    for (const name of [startLabel, endLabel]) {
      const input = view.getByLabelText(name);
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(input.getAttribute("aria-describedby")).toBe(alert.id);
    }
  });

  test("marks only the invalid date of a range", () => {
    const view = renderDate(lastVisit({ value: range }), {
      errorAt: (field) => (field === "value.to" ? "invalid" : undefined),
    });
    expect(view.getByRole("alert").textContent).toBe(
      m.emailCampaignsAudiencePeriodDateError({}, en)
    );
    expect(view.getByLabelText(startLabel).getAttribute("aria-invalid")).toBe(
      "false"
    );
    expect(view.getByLabelText(endLabel).getAttribute("aria-invalid")).toBe(
      "true"
    );
  });

  test.each([
    ["Since", false],
    ["Onward", true],
    ["Until", false],
  ] as const)("edits a %s period's one date, unbounded", (tag, readsOnward) => {
    const onChange = mock((_condition: AudienceCondition) => undefined);
    const period = { _tag: tag, date: "2026-03-01" };
    const view = renderDate(lastVisit({ value: period }), { onChange });
    const date = view.getByLabelText(dateLabel);
    expect((date as HTMLInputElement).value).toBe(period.date);
    expect(date.getAttribute("min")).toBeNull();
    expect(date.getAttribute("max")).toBeNull();
    expect(
      view.queryByText(m.emailCampaignsAudiencePeriodOnward({}, en)) !== null
    ).toBe(readsOnward);
    fireEvent.change(date, { target: { value: "2026-04-01" } });
    expect(changed(onChange)).toEqual(
      lastVisit({ value: { ...period, date: "2026-04-01" } })
    );
  });

  const productSelect = m.emailCampaignsAudienceProductSelectLabel({}, en);

  test("offers the reservation product only for reservation-based dates", () => {
    expect(
      renderDate(lastVisit()).queryByRole("combobox", { name: productSelect })
    ).not.toBeNull();
    cleanup();
    expect(
      renderDate({ ...newCondition("accountCreated") } as AudienceCondition, {
        attribute: "accountCreated",
      }).queryByRole("combobox", { name: productSelect })
    ).toBeNull();
  });

  test("sets the product, and drops it again for any product", async () => {
    const setProduct = mock((_condition: AudienceCondition) => undefined);
    const view = renderDate(lastVisit(), { onChange: setProduct });
    await choose(
      view,
      productSelect,
      reservationProductFamilyLabel(coworkReservationKind, "en-US")
    );
    expect(changed(setProduct)).toEqual(lastVisit({ params: { product } }));
    cleanup();

    const dropProduct = mock((_condition: AudienceCondition) => undefined);
    const withProduct = renderDate(lastVisit({ params: { product } }), {
      onChange: dropProduct,
    });
    await choose(
      withProduct,
      productSelect,
      m.emailCampaignsAudienceProductAny({}, en)
    );
    expect(changed(dropProduct)).toEqual(lastVisit());
  });
});

describe("SetConditionControls", () => {
  const setWording = (attribute: "locale" | "dotyposTags" | "discountGroup") =>
    audienceAttributeWording(attribute, "en-US") as AudienceSetWording;

  const renderSet = (
    attribute: "locale" | "dotyposTags" | "discountGroup",
    value: readonly string[],
    {
      onChange = () => undefined,
      invalid = false,
      lookups = {},
      wording = setWording(attribute),
    }: {
      readonly onChange?: (condition: AudienceCondition) => void;
      readonly invalid?: boolean;
      readonly lookups?: AudienceValueLookups;
      readonly wording?: AudienceSetWording;
    } = {}
  ) =>
    render(
      <RouteLocaleProvider locale="en-US">
        <SetConditionControls
          entry={audienceAttributeCatalogue[attribute]}
          wording={wording}
          value={{ ...newCondition(attribute), value } as AudienceCondition}
          onChange={onChange}
          errorAt={(field) =>
            invalid && field === "value" ? "empty" : undefined
          }
          path="filter.children.0"
          lookups={lookups}
        />
      </RouteLocaleProvider>
    );

  const valuesOf = (onChange: ReturnType<typeof mock>) =>
    onChange.mock.calls.map(([condition]) => condition.value);

  describe("fixed options", () => {
    const options = (wording: AudienceSetWording) =>
      wording.values._tag === "Options" ? wording.values.options : {};

    test("checks the chosen options and toggles one", () => {
      const onChange = mock((_condition: AudienceCondition) => undefined);
      const wording = setWording("locale");
      const view = renderSet("locale", ["cs-CZ"], { onChange });
      const czech = view.getByRole("checkbox", {
        name: options(wording)["cs-CZ"]?.label,
      });
      const english = view.getByRole("checkbox", {
        name: options(wording)["en-US"]?.label,
      });
      expect(czech.getAttribute("aria-checked")).toBe("true");
      expect(english.getAttribute("aria-checked")).toBe("false");
      expect(czech.id).toBe("filter.children.0.value.cs-CZ");
      fireEvent.click(english);
      fireEvent.click(czech);
      expect(valuesOf(onChange)).toEqual([["cs-CZ", "en-US"], []]);
    });

    test("labels an option without wording by its value", () => {
      const wording = setWording("locale");
      const view = renderSet("locale", [], {
        wording: { ...wording, values: { _tag: "Options", options: {} } },
      });
      expect(view.getByRole("checkbox", { name: "cs-CZ" })).toBeTruthy();
      expect(view.getByRole("checkbox", { name: "en-US" })).toBeTruthy();
    });

    test("marks every option when none is chosen", () => {
      const view = renderSet("locale", [], { invalid: true });
      const alert = view.getByRole("alert");
      expect(alert.textContent).toBe(setWording("locale").emptyError);
      for (const checkbox of view.getAllByRole("checkbox")) {
        expect(checkbox.getAttribute("aria-invalid")).toBe("true");
        expect(checkbox.getAttribute("aria-describedby")).toBe(alert.id);
      }
    });
  });

  describe("free-text values", () => {
    const entry = (wording: AudienceSetWording) => {
      if (wording.values._tag === "Options") throw new Error("no entry");
      return wording.values.entry;
    };
    const tagEntry = entry(setWording("dotyposTags"));

    test.each([
      ["Enter", { key: "Enter" }],
      ["a comma", { key: "," }],
    ] as const)("adds a trimmed value on %s", (_name, key) => {
      const onChange = mock((_condition: AudienceCondition) => undefined);
      const view = renderSet("dotyposTags", ["regular"], { onChange });
      const input = view.getByRole("textbox", { name: tagEntry.add });
      fireEvent.change(input, { target: { value: "  vip " } });
      fireEvent.keyDown(input, key);
      expect(valuesOf(onChange)).toEqual([["regular", "vip"]]);
      expect((input as HTMLInputElement).value).toBe("");
    });

    test("adds the draft on blur, but not a blank or repeated one", () => {
      const onChange = mock((_condition: AudienceCondition) => undefined);
      const view = renderSet("dotyposTags", ["regular"], { onChange });
      const input = view.getByRole("textbox", { name: tagEntry.add });
      fireEvent.keyDown(input, { key: "a" });
      fireEvent.change(input, { target: { value: "   " } });
      fireEvent.blur(input);
      fireEvent.change(input, { target: { value: "regular" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect((input as HTMLInputElement).value).toBe("");
      fireEvent.change(input, { target: { value: "new" } });
      fireEvent.blur(input);
      expect(valuesOf(onChange)).toEqual([["regular", "new"]]);
    });

    test("removes a value by its chip", () => {
      const onChange = mock((_condition: AudienceCondition) => undefined);
      const view = renderSet("dotyposTags", ["regular", "vip"], { onChange });
      fireEvent.click(
        view.getByRole("button", { name: tagEntry.remove("regular") })
      );
      expect(valuesOf(onChange)).toEqual([["vip"]]);
    });

    test("marks the entry when no value is given", () => {
      const view = renderSet("dotyposTags", [], { invalid: true });
      const input = view.getByRole("textbox", { name: tagEntry.add });
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(input.getAttribute("aria-describedby")).toBe(
        view.getByRole("alert").id
      );
    });

    test("enters looked-up values by ID when the list is missing", () => {
      const onChange = mock((_condition: AudienceCondition) => undefined);
      const groupEntry = entry(setWording("discountGroup"));
      const view = renderSet("discountGroup", [], { onChange });
      const groupLookup = setWording("discountGroup").values;
      expect(
        view.queryByRole("button", {
          name: groupLookup._tag === "Lookup" ? groupLookup.choose : "",
        })
      ).toBeNull();
      const input = view.getByRole("textbox", { name: groupEntry.add });
      fireEvent.change(input, { target: { value: "42" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(valuesOf(onChange)).toEqual([["42"]]);
    });
  });

  describe("looked-up values", () => {
    const wording = setWording("discountGroup");
    const lookup =
      wording.values._tag === "Lookup" ? wording.values : undefined;
    const discountGroups = [
      { id: "1", name: "Members" },
      { id: "2", name: "Students" },
    ];

    const openPicker = async (view: View) => {
      await act(async () => {
        fireEvent.keyDown(view.getByRole("button", { name: lookup?.choose }), {
          key: "Enter",
        });
      });
      return view.getAllByRole("menuitemcheckbox");
    };

    test("names chosen values from the list and an unknown one by its ID", () => {
      const onChange = mock((_condition: AudienceCondition) => undefined);
      const view = renderSet("discountGroup", ["1", "9"], {
        onChange,
        lookups: { discountGroups },
      });
      expect(
        view.getByRole("button", { name: lookup?.remove("Members") })
      ).toBeTruthy();
      fireEvent.click(
        view.getByRole("button", { name: lookup?.remove(lookup.unknown("9")) })
      );
      expect(valuesOf(onChange)).toEqual([["1"]]);
    });

    test("picks values from the list", async () => {
      const onChange = mock((_condition: AudienceCondition) => undefined);
      const view = renderSet("discountGroup", ["1"], {
        onChange,
        lookups: { discountGroups },
      });
      const items = await openPicker(view);
      expect(items.map((item) => item.textContent)).toEqual([
        "Members",
        "Students",
      ]);
      expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual([
        "true",
        "false",
      ]);
      await act(async () => {
        fireEvent.click(items[1] as HTMLElement);
      });
      expect(valuesOf(onChange)).toEqual([["1", "2"]]);
      expect(view.getAllByRole("menuitemcheckbox")).toHaveLength(2);
    });

    test.each([false, true])("marks the picker invalid: %p", (invalid) => {
      const view = renderSet("discountGroup", [], {
        invalid,
        lookups: { discountGroups },
      });
      const picker = view.getByRole("button", { name: lookup?.choose });
      expect(picker.getAttribute("aria-invalid")).toBe(String(invalid));
      expect(picker.getAttribute("aria-describedby")).toBe(
        invalid ? view.getByRole("alert").id : null
      );
    });
  });
});
