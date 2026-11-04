import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import type {
  ReservationProductFilterType,
  ReservationProductPropertyCondition,
} from "@deskohub/workspace-admin-api";
import { m } from "@/features/administration/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import type { WorkspaceReservationKind } from "@/features/reservation/reservation-kind";
import { reservationProductFamilies } from "@/features/reservation/reservation-product-descriptor";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import {
  reservationProductFamilyLabel,
  reservationProductPropertyLabel,
} from "./reservation-product-wording";

registerWorkspaceComponentTestEnv();
// @testing-library/react must load after the happy-dom registration.
const { act, cleanup, fireEvent, render, within } = await import(
  "@testing-library/react"
);
const { ProductFilterControl } = await import(
  "./reservation-product-filter-control"
);

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

const locale = "en-US";

type Filter = ReservationProductFilterType | undefined;

const renderControl = (
  value: Filter,
  onChange: (value: Filter) => void = () => undefined,
  errors: Readonly<Record<string, string>> = {}
) =>
  render(
    <RouteLocaleProvider locale={locale}>
      <ProductFilterControl
        value={value}
        onChange={onChange}
        errorAt={(field) => errors[field]}
      />
    </RouteLocaleProvider>
  );

type View = ReturnType<typeof renderControl>;

const changes = () => mock((_value: Filter) => undefined);

const filterOf = (
  family: WorkspaceReservationKind,
  ...properties: ReservationProductPropertyCondition[]
): ReservationProductFilterType =>
  ({ family, properties }) as ReservationProductFilterType;

const label = (family: WorkspaceReservationKind, property: string) =>
  reservationProductPropertyLabel(family, property, locale);

const tiers = reservationProductFamilies.cowork.properties[0].values;
const [historicalTier] = tiers.filter(({ retired }) => retired);
const [currentTier] = tiers.filter(({ retired }) => !retired);

const productSelect = (view: View) =>
  view.getByRole("combobox", {
    name: m.emailCampaignsAudienceProductSelectLabel({}, { locale }),
  });

const addConditionButton = (view: View) =>
  view.queryByRole("button", {
    name: m.emailCampaignsAudienceProductAddCondition({}, { locale }),
  });

const openMenu = async (trigger: HTMLElement) => {
  await act(async () => {
    fireEvent.keyDown(trigger, { key: "Enter" });
  });
};

const click = async (element: HTMLElement) => {
  await act(async () => {
    fireEvent.click(element);
  });
};

const chooseOption = async (view: View, select: HTMLElement, name: string) => {
  await openMenu(select);
  await click(view.getByRole("option", { name }));
};

describe("product family", () => {
  test("starts on any product, with no property conditions to add", () => {
    const view = renderControl(undefined);
    expect(productSelect(view).textContent).toBe(
      m.emailCampaignsAudienceProductAny({}, { locale })
    );
    expect(addConditionButton(view)).toBeNull();
  });

  test("lists any product and then every family", async () => {
    const view = renderControl(undefined);
    await openMenu(productSelect(view));
    expect(
      view.getAllByRole("option").map((option) => option.textContent)
    ).toEqual([
      m.emailCampaignsAudienceProductAny({}, { locale }),
      ...Object.values(reservationProductFamilies).map(({ id }) =>
        reservationProductFamilyLabel(id, locale)
      ),
    ]);
  });

  test("choosing a family starts it with no property conditions", async () => {
    const onChange = changes();
    const view = renderControl(undefined, onChange);
    await chooseOption(
      view,
      productSelect(view),
      reservationProductFamilyLabel("office", locale)
    );
    expect(onChange.mock.calls).toEqual([[filterOf("office")]]);
  });

  test("choosing any product drops the family and its conditions", async () => {
    const onChange = changes();
    const view = renderControl(
      filterOf("office", { property: "seats", operator: "gte", value: 2 }),
      onChange
    );
    await chooseOption(
      view,
      productSelect(view),
      m.emailCampaignsAudienceProductAny({}, { locale })
    );
    expect(onChange.mock.calls).toEqual([[undefined]]);
  });
});

describe("adding a property condition", () => {
  test("offers each property the filter has no condition on yet", async () => {
    const view = renderControl(
      filterOf("cowork", { property: "coffee", operator: "is", value: true })
    );
    await openMenu(addConditionButton(view) as HTMLElement);
    expect(
      view.getAllByRole("menuitem").map((item) => item.textContent)
    ).toEqual([label("cowork", "tier"), label("cowork", "monitor")]);
  });

  test("hides the add menu once every property has a condition", () => {
    const view = renderControl(
      filterOf("meeting-room", {
        property: "offer",
        operator: "anyOf",
        value: [],
      })
    );
    expect(addConditionButton(view)).toBeNull();
  });

  test.each([
    [
      "an enum property as “any of” nothing yet",
      "cowork",
      "tier",
      { property: "tier", operator: "anyOf", value: [] },
    ],
    [
      "a boolean property as “with”",
      "cowork",
      "coffee",
      { property: "coffee", operator: "is", value: true },
    ],
    [
      "a number property as “≥ 1”",
      "office",
      "days",
      { property: "days", operator: "gte", value: 1 },
    ],
  ] as const)("adds %s", async (_name, family, property, added) => {
    const onChange = changes();
    const existing = filterOf(family);
    const view = renderControl(existing, onChange);
    await openMenu(addConditionButton(view) as HTMLElement);
    await click(view.getByRole("menuitem", { name: label(family, property) }));
    expect(onChange.mock.calls).toEqual([[filterOf(family, added)]]);
  });
});

describe("property condition rows", () => {
  test("removes a condition and keeps the others", async () => {
    const onChange = changes();
    const coffee = { property: "coffee", operator: "is", value: true } as const;
    const tier = {
      property: "tier",
      operator: "anyOf",
      value: [currentTier?.id ?? ""],
    } as const;
    const view = renderControl(filterOf("cowork", coffee, tier), onChange);
    await click(
      view.getByRole("button", {
        name: m.emailCampaignsAudienceProductRemoveCondition(
          { property: label("cowork", "coffee") },
          { locale }
        ),
      })
    );
    expect(onChange.mock.calls).toEqual([[filterOf("cowork", tier)]]);
  });

  test("shows a property the catalog no longer has by its ID, with no controls", () => {
    const view = renderControl(
      filterOf("cowork", {
        property: "lounge",
        operator: "is",
        value: true,
      })
    );
    expect(view.getByText("lounge")).toBeTruthy();
    expect(view.queryAllByRole("radio")).toHaveLength(0);
    expect(
      view.getByRole("button", {
        name: m.emailCampaignsAudienceProductRemoveCondition(
          { property: "lounge" },
          { locale }
        ),
      })
    ).toBeTruthy();
  });

  test.each([
    ["operator", { "properties.0.operator": "invalid" }],
    ["value", { "properties.0.value": "invalid" }],
  ] as const)(
    "asks to choose a value when an enum condition's %s is invalid",
    (_field, errors) => {
      const view = renderControl(
        filterOf("cowork", { property: "tier", operator: "anyOf", value: [] }),
        undefined,
        errors
      );
      expect(view.getByRole("alert").textContent).toBe(
        m.emailCampaignsAudienceProductChooseValueError({}, { locale })
      );
    }
  );

  test("leaves a valid enum condition's alert empty", () => {
    const view = renderControl(
      filterOf("cowork", { property: "tier", operator: "anyOf", value: [] })
    );
    expect(view.getByRole("alert").textContent).toBe("");
  });
});

describe("enum property", () => {
  const tierLabel = () => label("cowork", "tier");
  const chooseButton = (view: View) =>
    view.getByRole("button", {
      name: m.emailCampaignsAudienceProductChoose({}, { locale }),
    });
  const removeChip = (view: View, valueName: string) =>
    view.getByRole("button", {
      name: m.emailCampaignsAudienceProductRemoveValue(
        { property: tierLabel().toLocaleLowerCase(locale), value: valueName },
        { locale }
      ),
    });

  test("lists the chosen values as chips, an unknown one by its ID", () => {
    const view = renderControl(
      filterOf("cowork", {
        property: "tier",
        operator: "noneOf",
        value: [currentTier?.id ?? "", "platinum"],
      })
    );
    expect(removeChip(view, currentTier?.name(locale) ?? "")).toBeTruthy();
    expect(removeChip(view, "platinum")).toBeTruthy();
    expect(
      view.getByRole("combobox", {
        name: m.emailCampaignsAudienceSetMatchLabel(
          { subject: tierLabel() },
          { locale }
        ),
      }).textContent
    ).toBe(
      m.emailCampaignsAudienceSetOperator({ operator: "noneOf" }, { locale })
    );
  });

  test("removing a chip keeps the operator and the other values", async () => {
    const onChange = changes();
    const view = renderControl(
      filterOf("cowork", {
        property: "tier",
        operator: "noneOf",
        value: [currentTier?.id ?? "", "platinum"],
      }),
      onChange
    );
    await click(removeChip(view, "platinum"));
    expect(onChange.mock.calls).toEqual([
      [
        filterOf("cowork", {
          property: "tier",
          operator: "noneOf",
          value: [currentTier?.id ?? ""],
        }),
      ],
    ]);
  });

  test("switching the operator keeps the chosen values", async () => {
    const onChange = changes();
    const view = renderControl(
      filterOf("cowork", {
        property: "tier",
        operator: "anyOf",
        value: [currentTier?.id ?? ""],
      }),
      onChange
    );
    await chooseOption(
      view,
      view.getByRole("combobox", {
        name: m.emailCampaignsAudienceSetMatchLabel(
          { subject: tierLabel() },
          { locale }
        ),
      }),
      m.emailCampaignsAudienceSetOperator({ operator: "noneOf" }, { locale })
    );
    expect(onChange.mock.calls).toEqual([
      [
        filterOf("cowork", {
          property: "tier",
          operator: "noneOf",
          value: [currentTier?.id ?? ""],
        }),
      ],
    ]);
  });

  test("checks the chosen values and marks retired ones", async () => {
    const view = renderControl(
      filterOf("cowork", {
        property: "tier",
        operator: "anyOf",
        value: [currentTier?.id ?? ""],
      })
    );
    await openMenu(chooseButton(view));
    const items = view.getAllByRole("menuitemcheckbox");
    expect(items).toHaveLength(tiers.length);
    expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual(
      tiers.map(({ id }) => String(id === currentTier?.id))
    );
    const retired = m.emailCampaignsAudienceProductRetired({}, { locale });
    expect(
      items.map((item) => within(item).queryByText(retired) !== null)
    ).toEqual(tiers.map((tier) => tier.retired));
  });

  test("checking a value adds it under the condition's operator", async () => {
    const onChange = changes();
    const view = renderControl(
      filterOf("cowork", {
        property: "tier",
        operator: "anyOf",
        value: [currentTier?.id ?? ""],
      }),
      onChange
    );
    await openMenu(chooseButton(view));
    const historical = view
      .getAllByRole("menuitemcheckbox")
      .find((item) =>
        item.textContent?.startsWith(historicalTier?.name(locale) ?? "-")
      );
    await click(historical as HTMLElement);
    expect(onChange.mock.calls).toEqual([
      [
        filterOf("cowork", {
          property: "tier",
          operator: "anyOf",
          value: [currentTier?.id ?? "", historicalTier?.id ?? ""],
        }),
      ],
    ]);
  });

  test("starts a condition of another kind over as “any of” nothing", async () => {
    const onChange = changes();
    const view = renderControl(
      filterOf("cowork", { property: "tier", operator: "is", value: true }),
      onChange
    );
    await openMenu(chooseButton(view));
    expect(
      view
        .getAllByRole("menuitemcheckbox")
        .map((item) => item.getAttribute("aria-checked"))
    ).toEqual(tiers.map(() => "false"));
    await click(view.getAllByRole("menuitemcheckbox")[0] as HTMLElement);
    expect(onChange.mock.calls).toEqual([
      [
        filterOf("cowork", {
          property: "tier",
          operator: "anyOf",
          value: [tiers[0]?.id ?? ""],
        }),
      ],
    ]);
  });

  test("points the choose button at the value error", () => {
    const view = renderControl(
      filterOf("cowork", { property: "tier", operator: "anyOf", value: [] }),
      undefined,
      { "properties.0.value": "invalid" }
    );
    const button = chooseButton(view);
    expect(button.getAttribute("aria-invalid")).toBe("true");
    expect(button.getAttribute("aria-describedby")).toBe(
      view.getByRole("alert").id
    );
  });

  test("leaves the choose button valid without a value error", () => {
    const view = renderControl(
      filterOf("cowork", { property: "tier", operator: "anyOf", value: [] })
    );
    const button = chooseButton(view);
    expect(button.getAttribute("aria-invalid")).toBe("false");
    expect(button.hasAttribute("aria-describedby")).toBe(false);
  });
});

describe("boolean property", () => {
  const radio = (view: View, name: string) =>
    view.getByRole("radio", { name }) as HTMLInputElement;
  const withLabel = m.emailCampaignsAudienceProductWith({}, { locale });
  const withoutLabel = m.emailCampaignsAudienceProductWithout({}, { locale });

  test.each([
    ["“is false” as without", { operator: "is", value: false }, false],
    ["“is true” as with", { operator: "is", value: true }, true],
    [
      "a condition of another kind as with",
      { operator: "anyOf", value: [] },
      true,
    ],
  ] as const)("shows %s", (_name, condition, withChecked) => {
    const view = renderControl(
      filterOf("cowork", {
        property: "coffee",
        ...condition,
      } as ReservationProductPropertyCondition)
    );
    expect(radio(view, withLabel).checked).toBe(withChecked);
    expect(radio(view, withoutLabel).checked).toBe(!withChecked);
  });

  test.each([
    [withLabel, { operator: "is", value: false }, true],
    [withoutLabel, { operator: "is", value: true }, false],
  ] as const)("choosing %s sets the value", async (name, condition, value) => {
    const onChange = changes();
    const view = renderControl(
      filterOf("cowork", { property: "coffee", ...condition }),
      onChange
    );
    await click(radio(view, name));
    expect(onChange.mock.calls).toEqual([
      [filterOf("cowork", { property: "coffee", operator: "is", value })],
    ]);
  });
});

describe("number property", () => {
  const seatsInput = (view: View) =>
    view.getByRole("spinbutton", {
      name: label("office", "seats"),
    }) as HTMLInputElement;

  test("edits the count and keeps the operator", async () => {
    const onChange = changes();
    const view = renderControl(
      filterOf("office", { property: "seats", operator: "lt", value: 4 }),
      onChange
    );
    expect(seatsInput(view).value).toBe("4");
    await act(async () => {
      fireEvent.change(seatsInput(view), { target: { value: "6" } });
    });
    expect(onChange.mock.calls).toEqual([
      [filterOf("office", { property: "seats", operator: "lt", value: 6 })],
    ]);
  });

  test("starts a condition of another kind over from “≥ blank”", async () => {
    const onChange = changes();
    const view = renderControl(
      filterOf("office", { property: "seats", operator: "anyOf", value: [] }),
      onChange
    );
    expect(seatsInput(view).value).toBe("");
    await act(async () => {
      fireEvent.change(seatsInput(view), { target: { value: "3" } });
    });
    expect(onChange.mock.calls).toEqual([
      [filterOf("office", { property: "seats", operator: "gte", value: 3 })],
    ]);
  });

  test("explains a count error like a count condition does", () => {
    const view = renderControl(
      filterOf("office", { property: "seats", operator: "gte", value: 1.5 }),
      undefined,
      { "properties.0.value": "invalid" }
    );
    expect(view.getByRole("alert").textContent).toBe(
      m.emailCampaignsAudienceCountWholeNumberError({}, { locale })
    );
    expect(seatsInput(view).getAttribute("aria-describedby")).toBe(
      view.getByRole("alert").id
    );
  });
});
