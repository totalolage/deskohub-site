import { afterAll, afterEach, expect, test } from "bun:test";
import type { EmailDraft } from "@deskohub/workspace-admin-api";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();
// React DOM and Radix detect the DOM when they load, so load them after it.
const { cleanup, render } = await import("@testing-library/react");
const { FormProvider, useForm } = await import("react-hook-form");
const { RouteLocaleProvider } = await import("@/features/i18n/route-locale");
const { EmailEditorProvider } = await import("./email-editor-context");
const { EmailBlockValueSettings } = await import(
  "./email-block-value-settings"
);

afterEach(() => cleanup());
afterAll(() => unregisterWorkspaceComponentTestEnv());

const locale = "en-US" satisfies Locale;
type Draft = typeof EmailDraft.Encoded;

/** Renders the settings of the first block of a draft with `structure`. */
const renderSettings = (structure: NonNullable<Draft["structure"]>) => {
  function Host() {
    const form = useForm<Draft>({ defaultValues: { structure } });
    return (
      <RouteLocaleProvider locale={locale}>
        <FormProvider {...form}>
          <EmailEditorProvider imageCloudName="cloud" locales={["en-US"]}>
            <EmailBlockValueSettings contentLocale="en-US" index={0} />
          </EmailEditorProvider>
        </FormProvider>
      </RouteLocaleProvider>
    );
  }
  return render(<Host />);
};

const valuePicker = m.emailsEditorBlockValue({}, { locale });

test("a value block offers its value choice", () => {
  const view = renderSettings([{ _tag: "Record", id: "block" }]);
  expect(view.getByRole("combobox", { name: valuePicker })).toBeDefined();
});

test.each([
  ["a block that shows no value", [{ _tag: "Paragraph", id: "block" }]],
  ["a value block without an id", [{ _tag: "Record" }]],
  ["a missing block", []],
] as const)("%s has no value settings", (_case, structure) => {
  const view = renderSettings(structure);
  expect(view.queryByRole("combobox", { name: valuePicker })).toBeNull();
  expect(view.container.childElementCount).toBe(0);
});
