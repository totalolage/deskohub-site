import { afterAll, afterEach, expect, test } from "bun:test";
import { supportedLocales } from "@deskohub/i18n/locale-registry";
import { useEffect } from "react";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { languageNames } from "@/features/i18n/language-labels";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { fixtureDraft } from "./email-editor.fixtures.test-utils";

registerWorkspaceComponentTestEnv();
// React DOM detects the DOM when it loads, so load it after registration.
const { act, cleanup, render, waitFor } = await import(
  "@testing-library/react"
);
const { useEmailEditor } = await import("./email-editor-context");
const { EmailEditorTestHost } = await import(
  "./email-editor-test-host.test-utils"
);
const { EmailPreviewPanel } = await import("./email-preview-panel");

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

const locale = "en-US";
type Answer = Awaited<
  ReturnType<import("./email-preview-panel").EmailPreviewRenderer>
>;

/** A renderer whose answers the test settles by hand, in any order. */
const deferredRenderer = () => {
  const requests: {
    readonly locale: string;
    readonly resolve: (answer: Answer) => void;
    readonly reject: (cause: unknown) => void;
  }[] = [];
  const renderPreview = ({ locale: language }: { readonly locale: string }) =>
    new Promise<Answer>((resolve, reject) =>
      requests.push({ locale: language, resolve, reject })
    );
  return { requests, renderPreview };
};

// The editor opens the first Workspace language; the tests switch to another.
const [opening] = supportedLocales;
const other = supportedLocales[1];
if (!other) throw new Error("The preview tests need two Workspace languages.");

let showLanguage: (language: Locale) => void = () => {};
function LanguageSwitch() {
  const { setActiveLocale } = useEmailEditor();
  useEffect(() => {
    showLanguage = setActiveLocale;
  });
  return null;
}

let form: import("./email-editor-test-host.test-utils").EmailEditorTestForm;
const renderPanel = (
  renderPreview: ReturnType<typeof deferredRenderer>["renderPreview"]
) =>
  render(
    <EmailEditorTestHost
      defaultValues={fixtureDraft}
      onForm={(host) => {
        form = host;
      }}
    >
      <LanguageSwitch />
      <EmailPreviewPanel renderPreview={renderPreview} />
    </EmailEditorTestHost>
  );

const frameTitle = (language: string) =>
  m.emailsEditorPreviewFrameTitle({ language }, { locale });
const status = (view: ReturnType<typeof renderPanel>) =>
  view.getByRole("status").textContent;

test("drops an answer whose language was left before it arrived", async () => {
  const renderer = deferredRenderer();
  const view = renderPanel(renderer.renderPreview);
  await waitFor(() => expect(renderer.requests).toHaveLength(1));
  // The opening language was asked for; switching outdates it at once.
  act(() => showLanguage(other));
  await act(async () =>
    renderer.requests[0]?.resolve({
      data: { subject: "Opening subject", html: "<p>Opening body</p>" },
    })
  );
  const otherFrame = view.getByTitle(frameTitle(languageNames[other]));
  expect(otherFrame.getAttribute("srcdoc")).toBe("");
  expect(status(view)).toBe(m.emailsEditorPreviewUpdating({}, { locale }));

  await waitFor(() => expect(renderer.requests).toHaveLength(2));
  expect(renderer.requests[1]?.locale).toBe(other);
  await act(async () =>
    renderer.requests[1]?.resolve({
      data: { subject: "Other subject", html: "<p>Other body</p>" },
    })
  );
  expect(otherFrame.getAttribute("srcdoc")).toBe("<p>Other body</p>");
  expect(status(view)).toBe(m.emailsEditorPreviewUpdated({}, { locale }));
});

test("drops an answer to a draft edited since, in the same language", async () => {
  const renderer = deferredRenderer();
  const view = renderPanel(renderer.renderPreview);
  await waitFor(() => expect(renderer.requests).toHaveLength(1));
  act(() =>
    form.setValue(`translations.${opening}.subject`, [
      { _tag: "Text", text: "Edited" },
    ])
  );
  await act(async () =>
    renderer.requests[0]?.resolve({
      data: { subject: "Before the edit", html: "<p>Before the edit</p>" },
    })
  );
  expect(
    view.getByTitle(frameTitle(languageNames[opening])).getAttribute("srcdoc")
  ).toBe("");
  expect(status(view)).toBe(m.emailsEditorPreviewUpdating({}, { locale }));
  await waitFor(() => expect(renderer.requests).toHaveLength(2));
});

test("a failure clears the earlier picture and shows the server's message", async () => {
  const renderer = deferredRenderer();
  const view = renderPanel(renderer.renderPreview);
  await waitFor(() => expect(renderer.requests).toHaveLength(1));
  await act(async () =>
    renderer.requests[0]?.resolve({
      data: { subject: "Opening subject", html: "<p>Opening body</p>" },
    })
  );
  const openingFrame = view.getByTitle(frameTitle(languageNames[opening]));
  expect(openingFrame.getAttribute("srcdoc")).toBe("<p>Opening body</p>");

  act(() => showLanguage(other));
  await waitFor(() => expect(renderer.requests).toHaveLength(2));
  const serverError = m.emailsActionFailedUnexpectedly({}, { locale });
  await act(async () => renderer.requests[1]?.resolve({ serverError }));
  expect(view.getByRole("alert").textContent).toBe(serverError);
  expect(
    view.getByTitle(frameTitle(languageNames[other])).getAttribute("srcdoc")
  ).toBe("");
  expect(status(view)).toBe("");

  act(() => showLanguage(opening));
  await waitFor(() => expect(renderer.requests).toHaveLength(3));
  await act(async () => renderer.requests[2]?.reject(new Error("offline")));
  expect(view.getByRole("alert").textContent).toBe(
    m.emailsEditorPreviewFailed({}, { locale })
  );
  expect(
    view.getByTitle(frameTitle(languageNames[opening])).getAttribute("srcdoc")
  ).toBe("");
});
