import { afterAll, afterEach, expect, test } from "bun:test";
import { m } from "@/features/administration/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { EmailDraftFormValues } from "./email-draft-form";

registerWorkspaceComponentTestEnv();
// React DOM detects the DOM when it loads, so load it after registration.
const { cleanup, render } = await import("@testing-library/react");
const { EmailEditorTestHost } = await import(
  "./email-editor-test-host.test-utils"
);
const { emailEditorFieldIds } = await import("./email-editor-field-ids");
const { EmailLanguageFields } = await import("./email-language-fields");

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

const locale = "en-US";
const contentLocale = "cs-CZ";
const text = (value: string) => [{ _tag: "Text" as const, text: value }];

const renderFields = async (defaultValues: EmailDraftFormValues) => {
  const view = render(
    <EmailEditorTestHost defaultValues={defaultValues}>
      <EmailLanguageFields contentLocale={contentLocale} />
    </EmailEditorTestHost>
  );
  // Every language has a subject; the editors start after the first render.
  const subject = await view.findByRole("textbox", {
    name: m.emailsEditorSubjectLabel({}, { locale }),
  });
  const reason = () =>
    view.queryByRole("textbox", {
      name: m.emailsEditorOperationalReasonLabel({}, { locale }),
    });
  const unusedHint = () =>
    view.queryByText(m.emailsEditorOperationalReasonUnusedHint({}, { locale }));
  return { view, subject, reason, unusedHint };
};

test("an operational email's language has a subject, a preheader and a reason", async () => {
  const { view, subject, reason, unusedHint } = await renderFields({
    purpose: "operational",
  });
  const preheader = view.getByRole("textbox", {
    name: m.emailsEditorPreheaderLabel({}, { locale }),
  });
  expect(subject.id).toBe(
    emailEditorFieldIds.translation(contentLocale, "subject")
  );
  expect(preheader.id).toBe(
    emailEditorFieldIds.translation(contentLocale, "preheader")
  );
  expect(reason()?.id).toBe(
    emailEditorFieldIds.translation(contentLocale, "operationalReason")
  );
  expect(unusedHint()).toBeNull();
});

test("a marketing email has no reason to edit", async () => {
  const { view, reason, unusedHint } = await renderFields({
    purpose: "marketing",
    translations: { [contentLocale]: { subject: text("Novinky") } },
  });
  expect(view.getAllByRole("textbox")).toHaveLength(2);
  expect(reason()).toBeNull();
  expect(unusedHint()).toBeNull();
});

test("a reason stored before the email became a marketing one stays editable and is marked unused", async () => {
  const { reason, unusedHint } = await renderFields({
    purpose: "marketing",
    translations: {
      [contentLocale]: { operationalReason: text("Máte u nás rezervaci") },
    },
  });
  expect(reason()?.textContent).toBe("Máte u nás rezervaci");
  expect(unusedHint()).not.toBeNull();
});

test("an operational email's stored reason is not marked unused", async () => {
  const { reason, unusedHint } = await renderFields({
    purpose: "operational",
    translations: {
      [contentLocale]: { operationalReason: text("Máte u nás rezervaci") },
    },
  });
  expect(reason()).not.toBeNull();
  expect(unusedHint()).toBeNull();
});
