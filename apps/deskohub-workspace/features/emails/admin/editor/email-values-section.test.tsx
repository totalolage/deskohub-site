import { afterAll, afterEach, expect, test } from "bun:test";
import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { EmailDraft } from "@deskohub/workspace-admin-api";
import { useEffect } from "react";
import { FormProvider, type UseFormReturn, useForm } from "react-hook-form";
import { m } from "@/features/administration/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { EmailDraftFormValues } from "./email-draft-form";

registerWorkspaceComponentTestEnv();
// React DOM detects the DOM when it loads, so load it after registration.
const { act, cleanup, fireEvent, render, within } = await import(
  "@testing-library/react"
);
const { EmailEditorProvider } = await import("./email-editor-context");
const { emailEditorFieldIds } = await import("./email-editor-field-ids");
const { EmailValuesSection } = await import("./email-values-section");

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

const locale = "en-US";
const discounts = [
  { id: "discount-autumn", label: "Autumn coworking" },
  { id: "discount-friends", label: "Friends of the house" },
];

let form: UseFormReturn<EmailDraftFormValues, unknown, EmailDraft>;

function Host({
  defaultValues,
}: {
  readonly defaultValues: EmailDraftFormValues;
}) {
  const host = useForm<EmailDraftFormValues, unknown, EmailDraft>({
    resolver: effectSchemaResolver(EmailDraft),
    defaultValues,
  });
  useEffect(() => {
    form = host;
  });
  return (
    <RouteLocaleProvider locale={locale}>
      <FormProvider {...host}>
        <EmailEditorProvider locales={["en-US", "cs-CZ"]}>
          <EmailValuesSection discounts={discounts} />
        </EmailEditorProvider>
      </FormProvider>
    </RouteLocaleProvider>
  );
}

const renderSection = (defaultValues: EmailDraftFormValues = {}) =>
  render(<Host defaultValues={defaultValues} />);
type View = ReturnType<typeof renderSection>;

const values = () => form.getValues("values");
const byId = (id: string) => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`No element #${id}`);
  return element;
};
const definitionAt = (index: number) =>
  within(byId(emailEditorFieldIds.value(index)));

const openCustomerPicker = async (view: View) => {
  await act(async () => {
    fireEvent.click(
      view.getByRole("button", {
        name: m.emailsEditorValuesAddCustomer({}, { locale }),
      })
    );
  });
  return view.getByRole("combobox", {
    name: m.emailsEditorValuesPickerSearch({}, { locale }),
  });
};
const search = async (input: HTMLElement, text: string) => {
  await act(async () => {
    fireEvent.change(input, { target: { value: text } });
  });
};
/** Clicks the picker option for exactly the customer field `path`. */
const pickOption = async (view: View, path: string) => {
  const option = view
    .getAllByRole("option")
    .find((candidate) => within(candidate).queryByText(path) !== null);
  if (!option) throw new Error(`No option for ${path}`);
  await act(async () => {
    fireEvent.click(option);
  });
};
const addCustomerValue = async (view: View, path: string) => {
  await search(await openCustomerPicker(view), path);
  await pickOption(view, path);
};

/** Opens a Radix select by keyboard and chooses the option named `name`. */
const choose = async (view: View, trigger: HTMLElement, name: string) => {
  await act(async () => {
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
  });
  await act(async () => {
    fireEvent.click(view.getByRole("option", { name }));
  });
};
const type = async (element: HTMLElement, value: string) => {
  await act(async () => {
    fireEvent.change(element, { target: { value } });
  });
};

test("explains values while the email has none", () => {
  const view = renderSection();
  view.getByRole("heading", {
    name: m.emailsEditorValuesHeading({}, { locale }),
  });
  view.getByText(m.emailsEditorValuesEmpty({}, { locale }));
  expect(view.queryByRole("list")).toBeNull();
});

test("groups the customer fields by kind and sorts each group by path", async () => {
  const view = renderSection();
  await openCustomerPicker(view);
  const groups = view.getAllByRole("group");
  expect(groups).toHaveLength(3);
  for (const group of groups) {
    const paths = within(group)
      .getAllByRole("option")
      .map((option) => option.getAttribute("data-value"));
    expect(paths.length).toBeGreaterThan(0);
    expect(paths).toEqual(
      paths.toSorted((left = "", right = "") => left.localeCompare(right, "en"))
    );
  }
});

test("adds a customer scalar value picked by search and keyboard", async () => {
  const view = renderSection();
  const input = await openCustomerPicker(view);
  const everyOption = view.getAllByRole("option").length;
  await search(input, "displayname");
  const options = view.getAllByRole("option");
  expect(options.length).toBeGreaterThan(0);
  expect(options.length).toBeLessThan(everyOption);
  for (const option of options)
    expect(option.textContent?.toLowerCase()).toContain("displayname");
  await search(input, "profile.customer.displayName");
  await act(async () => {
    fireEvent.keyDown(input, { key: "Enter" });
  });
  expect(view.queryByRole("option")).toBeNull();
  expect(values()).toEqual([
    {
      name: "display_name",
      source: {
        kind: "customer",
        path: ["profile", "customer", "displayName"],
      },
    },
  ]);
  expect(document.activeElement).toBe(
    byId(emailEditorFieldIds.valueSetting(0, "name"))
  );
  definitionAt(0).getByText(m.emailsEditorValuesKindScalar({}, { locale }));
});

test("suggests a unique name when the field is already a value", async () => {
  const view = renderSection();
  await addCustomerValue(view, "activity.reservations");
  await addCustomerValue(view, "activity.reservations");
  expect(values()?.map((definition) => definition.name)).toEqual([
    "reservations",
    "reservations_2",
  ]);
});

test("selects the fields a record value includes", async () => {
  const view = renderSection();
  await addCustomerValue(view, "activity.stats");
  const definition = definitionAt(0);
  const reservationCount = definition.getByRole("checkbox", {
    name: "reservationCount",
  });
  const favoriteProduct = definition.getByRole("checkbox", {
    name: "favoriteProduct",
  });
  await act(async () => {
    fireEvent.click(favoriteProduct);
  });
  await act(async () => {
    fireEvent.click(reservationCount);
  });
  // Fields keep the record's order, not the order they were chosen in.
  expect(values()?.[0]?.source).toEqual({
    kind: "customer",
    path: ["activity", "stats"],
    fields: [["reservationCount"], ["favoriteProduct"]],
  });
  await act(async () => {
    fireEvent.click(reservationCount);
  });
  await act(async () => {
    fireEvent.click(favoriteProduct);
  });
  expect(values()?.[0]?.source).toEqual({
    kind: "customer",
    path: ["activity", "stats"],
  });
  expect(
    definition.queryByLabelText(m.emailsEditorValuesSortLabel({}, { locale }))
  ).toBeNull();
});

test("sorts and limits a list value", async () => {
  const view = renderSection();
  await addCustomerValue(view, "activity.stats.revenue");
  const definition = definitionAt(0);
  await act(async () => {
    fireEvent.click(definition.getByRole("checkbox", { name: "value" }));
  });
  const sort = byId(emailEditorFieldIds.valueSetting(0, "sort"));
  await choose(view, sort, "value");
  expect(values()?.[0]?.source?.sort).toEqual({
    path: ["value"],
    direction: "asc",
  });
  await choose(
    view,
    definition.getByLabelText(
      m.emailsEditorValuesSortDirectionLabel({}, { locale })
    ),
    m.emailsEditorValuesSortDescending({}, { locale })
  );
  const limit = byId(emailEditorFieldIds.valueSetting(0, "limit"));
  await type(limit, "3");
  expect(values()?.[0]?.source).toEqual({
    kind: "customer",
    path: ["activity", "stats", "revenue"],
    fields: [["value"]],
    sort: { path: ["value"], direction: "desc" },
    limit: 3,
  });

  await type(limit, "");
  await choose(view, sort, m.emailsEditorValuesSortNone({}, { locale }));
  expect(values()?.[0]?.source).toEqual({
    kind: "customer",
    path: ["activity", "stats", "revenue"],
    fields: [["value"]],
  });
});

test("changing the field resets the settings that belonged to the old one", async () => {
  const view = renderSection({
    values: [
      {
        name: "revenue",
        source: {
          kind: "customer",
          path: ["activity", "stats", "revenue"],
          fields: [["value"]],
          sort: { path: ["value"], direction: "desc" },
          limit: 2,
        },
        customerShape: {
          kind: "unsupported",
          nullable: false,
          optional: false,
        },
        fallback: { "en-US": "nothing yet" },
      },
    ],
  });
  await act(async () => {
    fireEvent.click(byId(emailEditorFieldIds.valueSetting(0, "path")));
  });
  await search(
    view.getByRole("combobox", {
      name: m.emailsEditorValuesPickerSearch({}, { locale }),
    }),
    "activity.reservations"
  );
  await pickOption(view, "activity.reservations");
  expect(values()).toEqual([
    {
      name: "revenue",
      source: { kind: "customer", path: ["activity", "reservations"] },
      fallback: { "en-US": "nothing yet" },
    },
  ]);
  expect(
    byId(emailEditorFieldIds.valueSetting(0, "path")).textContent
  ).toContain("activity.reservations");
});

test("adds a discount value with single-use codes by default", async () => {
  const view = renderSection();
  await act(async () => {
    fireEvent.click(
      view.getByRole("button", {
        name: m.emailsEditorValuesAddDiscount({}, { locale }),
      })
    );
  });
  expect(values()).toEqual([
    {
      name: "discount",
      source: { kind: "discount", maxUses: 1, maxUsesPerCustomer: 1 },
    },
  ]);
  await choose(
    view,
    byId(emailEditorFieldIds.valueSetting(0, "discountId")),
    "Friends of the house"
  );
  await type(byId(emailEditorFieldIds.valueSetting(0, "validDays")), "14");
  await type(byId(emailEditorFieldIds.valueSetting(0, "maxUses")), "");
  expect(values()?.[0]?.source).toEqual({
    kind: "discount",
    discountId: "discount-friends",
    validDays: 14,
    maxUsesPerCustomer: 1,
  });
});

test("renames a value and sets its fallback per language", async () => {
  const view = renderSection({
    values: [{ name: "first_name", source: { kind: "customer", path: [] } }],
  });
  await type(byId(emailEditorFieldIds.valueSetting(0, "name")), "greeting");
  const fallback = (language: string) =>
    view.getByLabelText(
      m.emailsEditorValuesFallbackLabel({ language }, { locale })
    );
  await type(fallback("English"), "friend");
  await type(fallback("Czech"), "příteli");
  expect(values()?.[0]).toEqual({
    name: "greeting",
    source: { kind: "customer", path: [] },
    fallback: { "en-US": "friend", "cs-CZ": "příteli" },
  });
  await type(fallback("English"), "");
  await type(fallback("Czech"), "");
  expect(values()?.[0]).toEqual({
    name: "greeting",
    source: { kind: "customer", path: [] },
  });
});

test("reorders and deletes values", async () => {
  const view = renderSection({
    values: [
      { name: "first", source: { kind: "discount" } },
      { name: "second", source: { kind: "discount" } },
      { name: "third", source: { kind: "discount" } },
    ],
  });
  const names = () => values()?.map((definition) => definition.name);
  const button = (label: string) => view.getByRole("button", { name: label });
  expect(
    (
      button(
        m.emailsEditorValuesMoveUp({ name: "first" }, { locale })
      ) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  await act(async () => {
    fireEvent.click(
      button(m.emailsEditorValuesMoveDown({ name: "first" }, { locale }))
    );
  });
  expect(names()).toEqual(["second", "first", "third"]);
  await act(async () => {
    fireEvent.click(
      button(m.emailsEditorValuesMoveUp({ name: "third" }, { locale }))
    );
  });
  expect(names()).toEqual(["second", "third", "first"]);
  expect(
    within(byId(emailEditorFieldIds.value(0))).getByRole("heading").textContent
  ).toBe("second");
  await act(async () => {
    fireEvent.click(
      button(m.emailsEditorValuesDelete({ name: "third" }, { locale }))
    );
  });
  expect(names()).toEqual(["second", "first"]);
  expect(view.getAllByRole("listitem")).toHaveLength(2);
});

test("marks only values no text or block refers to as unused", () => {
  renderSection({
    structure: [{ _tag: "Record", id: "block-1", value: "booking" }],
    values: [
      { name: "booking", source: { kind: "discount" } },
      { name: "spare", source: { kind: "discount" } },
    ],
  });
  const unused = m.emailsEditorValuesUnused({}, { locale });
  expect(definitionAt(0).queryByText(unused)).toBeNull();
  definitionAt(1).getByText(unused);
  definitionAt(1).getByText(m.emailsEditorValuesUnusedHint({}, { locale }));
});

test("shows a definition's problems on the control they concern", () => {
  // Publication drops unfinished unused values, so only used ones have problems.
  renderSection({
    structure: [
      { _tag: "Offer", id: "block-1", value: "Not Valid" },
      { _tag: "Offer", id: "block-2", value: "code" },
    ],
    values: [
      { name: "Not Valid", source: { kind: "discount" } },
      { name: "code", source: { kind: "discount" } },
    ],
  });
  const expectProblem = (id: string, message: string) => {
    const control = byId(id);
    expect(control.getAttribute("aria-invalid")).toBe("true");
    const describedBy = control.getAttribute("aria-describedby")?.split(" ");
    const problems = describedBy?.map((problemsId) => byId(problemsId));
    expect(problems?.some((list) => list.textContent?.includes(message))).toBe(
      true
    );
  };
  expectProblem(
    emailEditorFieldIds.valueSetting(0, "name"),
    m.emailsEditorProblemValueNameInvalid({}, { locale })
  );
  expectProblem(
    emailEditorFieldIds.valueSetting(1, "discountId"),
    m.emailsEditorProblemValueDiscount({}, { locale })
  );
  expectProblem(
    emailEditorFieldIds.valueSetting(1, "validDays"),
    m.emailsEditorProblemValueValidDays({}, { locale })
  );
  expect(
    byId(emailEditorFieldIds.valueSetting(1, "name")).getAttribute(
      "aria-invalid"
    )
  ).toBeNull();
});

test("keeps focus on a move button when a move reaches either end", async () => {
  const view = renderSection({
    values: [
      { name: "first", source: { kind: "discount" } },
      { name: "second", source: { kind: "discount" } },
    ],
  });
  const button = (label: string) => view.getByRole("button", { name: label });
  await act(async () => {
    const moveDown = button(
      m.emailsEditorValuesMoveDown({ name: "first" }, { locale })
    );
    moveDown.focus();
    fireEvent.click(moveDown);
  });
  expect(values()?.map((definition) => definition.name)).toEqual([
    "second",
    "first",
  ]);
  expect(document.activeElement).toBe(
    button(m.emailsEditorValuesMoveUp({ name: "first" }, { locale }))
  );
});

test("edits a moved value at its new place and follows a host reset", async () => {
  const view = renderSection({
    values: [
      { name: "first", source: { kind: "discount" } },
      { name: "second", source: { kind: "discount" } },
    ],
  });
  await act(async () => {
    fireEvent.click(
      view.getByRole("button", {
        name: m.emailsEditorValuesMoveDown({ name: "first" }, { locale }),
      })
    );
  });
  const firstName = definitionAt(1).getByLabelText(
    m.emailsEditorValuesNameLabel({}, { locale })
  ) as HTMLInputElement;
  expect(firstName.value).toBe("first");
  await type(firstName, "renamed");
  expect(values()?.map((definition) => definition.name)).toEqual([
    "second",
    "renamed",
  ]);

  await act(async () => {
    form.reset({
      values: [
        { name: "restored", source: { kind: "discount", validDays: 3 } },
      ],
    });
  });
  expect(view.getAllByRole("listitem")).toHaveLength(1);
  expect(
    (byId(emailEditorFieldIds.valueSetting(0, "name")) as HTMLInputElement)
      .value
  ).toBe("restored");
  expect(
    (byId(emailEditorFieldIds.valueSetting(0, "validDays")) as HTMLInputElement)
      .value
  ).toBe("3");
});

test("drops a list's sort when its field is no longer included", async () => {
  renderSection({
    values: [
      {
        name: "revenue",
        source: {
          kind: "customer",
          path: ["activity", "stats", "revenue"],
          fields: [["value"], ["currency"]],
          sort: { path: ["value"], direction: "desc" },
        },
      },
    ],
  });
  await act(async () => {
    fireEvent.click(
      definitionAt(0).getByRole("checkbox", { name: "currency" })
    );
  });
  expect(values()?.[0]?.source?.sort).toEqual({
    path: ["value"],
    direction: "desc",
  });
  await act(async () => {
    fireEvent.click(definitionAt(0).getByRole("checkbox", { name: "value" }));
  });
  expect(values()?.[0]?.source).toEqual({
    kind: "customer",
    path: ["activity", "stats", "revenue"],
  });
});

test("leaves a number setting unset rather than rounding a fraction", async () => {
  renderSection({
    values: [{ name: "code", source: { kind: "discount", validDays: 7 } }],
  });
  const validDays = byId(emailEditorFieldIds.valueSetting(0, "validDays"));
  await type(validDays, "1.5");
  expect(values()?.[0]?.source).toEqual({ kind: "discount" });
  await type(validDays, "30");
  expect(values()?.[0]?.source).toEqual({ kind: "discount", validDays: 30 });
});

test("gives a definition without a source a customer field", async () => {
  const view = renderSection({ values: [{ name: "pending" }] });
  await act(async () => {
    fireEvent.click(byId(emailEditorFieldIds.valueSetting(0, "path")));
  });
  await search(
    view.getByRole("combobox", {
      name: m.emailsEditorValuesPickerSearch({}, { locale }),
    }),
    "profile.customer.email"
  );
  await pickOption(view, "profile.customer.email");
  expect(values()).toEqual([
    {
      name: "pending",
      source: { kind: "customer", path: ["profile", "customer", "email"] },
    },
  ]);
});
