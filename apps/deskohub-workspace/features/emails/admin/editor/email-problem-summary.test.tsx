import { afterAll, afterEach, expect, test } from "bun:test";
import { m } from "@/features/administration/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { EmailDraftFormValues } from "./email-draft-form";

registerWorkspaceComponentTestEnv();
// React DOM detects the DOM when it loads, so load it after registration.
const { cleanup, fireEvent, render, waitFor, within } = await import(
  "@testing-library/react"
);
const { useEmailEditor } = await import("./email-editor-context");
const { EmailEditorTestHost } = await import(
  "./email-editor-test-host.test-utils"
);
const { emailEditorFieldIds } = await import("./email-editor-field-ids");
const { emailEditorProblems } = await import("./email-editor-problems");
const { EmailLanguageFields } = await import("./email-language-fields");
const { EmailProblemSummary } = await import("./email-problem-summary");

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

const locale = "en-US";
const locales = ["en-US", "cs-CZ"] as const;
const text = (value: string) => [{ _tag: "Text" as const, text: value }];

/** The texts of the language the editor shows, as the editor lays them out. */
function ActiveLanguageFields() {
  const { activeLocale } = useEmailEditor();
  return (
    <EmailLanguageFields contentLocale={activeLocale} key={activeLocale} />
  );
}

const renderSummary = (defaultValues: EmailDraftFormValues) =>
  render(
    <EmailEditorTestHost defaultValues={defaultValues} locales={locales}>
      <EmailProblemSummary />
      <ActiveLanguageFields />
    </EmailEditorTestHost>
  );

const translation = {
  subject: text("Subject"),
  preheader: text("Preheader"),
  texts: { "paragraph-1-text": text("Paragraph") },
};
/** A draft publication accepts in every current language. */
const readyDraft: EmailDraftFormValues = {
  purpose: "marketing",
  templateKey: "workspace",
  values: [],
  structure: [
    { _tag: "Paragraph", id: "paragraph-1", textKey: "paragraph-1-text" },
  ],
  translations: { "en-US": translation, "cs-CZ": translation },
};
const problemsOf = (draft: EmailDraftFormValues) =>
  emailEditorProblems({
    draft,
    currentLocales: locales,
    locale,
    imageCloudName: undefined,
    publishedImageSources: new Set(),
  });
const problemButton = (
  list: HTMLElement,
  { place, message }: ReturnType<typeof problemsOf>[number]
) =>
  within(list).getByRole("button", {
    name: m.emailsEditorProblemSummaryItem({ place, message }, { locale }),
  });

test("a draft ready for publication lists no problems", () => {
  const view = renderSummary(readyDraft);
  expect(view.getByRole("status").textContent).toBe(
    m.emailsEditorProblemsNone({}, { locale })
  );
  expect(view.queryByRole("list")).toBeNull();
});

test("each problem leads to its field in its language", async () => {
  const draft: EmailDraftFormValues = {
    ...readyDraft,
    translations: {
      "en-US": translation,
      "cs-CZ": { ...translation, subject: undefined },
    },
  };
  const problems = problemsOf(draft);
  const czechSubject = emailEditorFieldIds.translation("cs-CZ", "subject");
  const missing = problems.find(({ fieldId }) => fieldId === czechSubject);
  if (!missing) throw new Error("The draft lacks a Czech subject problem");
  const view = renderSummary(draft);
  expect(view.getByRole("status").textContent).toBe(
    m.emailsEditorProblemsCount({ count: problems.length }, { locale })
  );
  const list = view.getByRole("list");
  expect(within(list).getAllByRole("button")).toHaveLength(problems.length);

  // The editor shows English first, so the Czech subject isn't there yet.
  expect(document.getElementById(czechSubject)).toBeNull();
  fireEvent.click(problemButton(list, missing));
  await waitFor(() => expect(document.activeElement?.id).toBe(czechSubject));
});

test("a problem of the whole email names no field to move to", () => {
  const draft = { ...readyDraft, values: undefined };
  const [problem, ...others] = problemsOf(draft);
  if (!problem || others.length > 0 || problem.fieldId)
    throw new Error("The draft should have one problem of the whole email");
  const view = renderSummary(draft);
  const button = problemButton(view.getByRole("list"), problem);
  expect(button.hasAttribute("disabled")).toBe(true);
});
