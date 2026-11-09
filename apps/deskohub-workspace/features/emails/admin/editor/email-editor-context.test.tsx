import { afterAll, afterEach, expect, test } from "bun:test";
import { useEffect, useState } from "react";
import type { Locale } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { EmailEditorProblem } from "./email-editor-problems";

registerWorkspaceComponentTestEnv();
// React DOM detects the DOM when it loads, so load it after registration.
const { act, cleanup, render, waitFor } = await import(
  "@testing-library/react"
);
const { useEmailEditor } = await import("./email-editor-context");
const { EmailEditorTestHost } = await import(
  "./email-editor-test-host.test-utils"
);

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

const settingsFieldId = "email-settings-field";
const languageFieldId = (language: Locale) => `email-${language}-field`;

/** A field that mounts a moment after its language shows, as a rich text editor does. */
function LateField({ id }: { readonly id: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setMounted(true));
    return () => clearTimeout(timer);
  }, []);
  return mounted && <input id={id} />;
}

let editor: ReturnType<typeof useEmailEditor>;
/** Shows the active language's field, and a field every language shares. */
function Fields() {
  const state = useEmailEditor();
  useEffect(() => {
    editor = state;
  });
  return (
    <>
      <input id={settingsFieldId} />
      <LateField
        id={languageFieldId(state.activeLocale)}
        key={state.activeLocale}
      />
    </>
  );
}

const renderEditor = () =>
  render(
    <EmailEditorTestHost defaultValues={{}} locales={["cs-CZ", "en-US"]}>
      <Fields />
    </EmailEditorTestHost>
  );

const problem = (
  placed: Pick<EmailEditorProblem, "fieldId" | "locale">
): EmailEditorProblem => ({ ...placed, message: "Problem", place: "Place" });
const focused = () => document.activeElement?.id;

test("a problem shows its language and focuses its field once the field mounts", async () => {
  renderEditor();
  await waitFor(() =>
    expect(document.getElementById(languageFieldId("cs-CZ"))).not.toBeNull()
  );
  act(() =>
    editor.focusProblem(
      problem({ fieldId: languageFieldId("en-US"), locale: "en-US" })
    )
  );
  expect(editor.activeLocale).toBe("en-US");
  await waitFor(() => expect(focused()).toBe(languageFieldId("en-US")));
});

test("a problem in a language the Workspace no longer offers keeps the active language", async () => {
  renderEditor();
  act(() =>
    editor.focusProblem(problem({ fieldId: settingsFieldId, locale: "de-DE" }))
  );
  expect(editor.activeLocale).toBe("cs-CZ");
  await waitFor(() => expect(focused()).toBe(settingsFieldId));
});

test("asking for the same field again focuses it again", async () => {
  renderEditor();
  const settings = problem({ fieldId: settingsFieldId, locale: undefined });
  act(() => editor.focusProblem(settings));
  await waitFor(() => expect(focused()).toBe(settingsFieldId));
  act(() => document.getElementById(settingsFieldId)?.blur());
  expect(focused()).not.toBe(settingsFieldId);
  act(() => editor.focusProblem(settings));
  await waitFor(() => expect(focused()).toBe(settingsFieldId));
});

test("a problem without a field shows its language and leaves focus where it was", async () => {
  renderEditor();
  act(() => document.getElementById(settingsFieldId)?.focus());
  act(() =>
    editor.focusProblem(problem({ fieldId: undefined, locale: "en-US" }))
  );
  expect(editor.activeLocale).toBe("en-US");
  await waitFor(() =>
    expect(document.getElementById(languageFieldId("en-US"))).not.toBeNull()
  );
  expect(focused()).toBe(settingsFieldId);
});

test("a problem of the whole email changes neither the language nor focus", () => {
  renderEditor();
  act(() => document.getElementById(settingsFieldId)?.focus());
  act(() =>
    editor.focusProblem(problem({ fieldId: undefined, locale: undefined }))
  );
  expect(editor.activeLocale).toBe("cs-CZ");
  expect(focused()).toBe(settingsFieldId);
});
