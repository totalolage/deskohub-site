import { afterAll, afterEach, expect, test } from "bun:test";
import { useEffect } from "react";
import { m } from "@/features/administration/i18n";
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

let showLanguage: (language: "cs-CZ" | "en-US") => void = () => {};
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
const czech = m.emailsEditorLanguageCzech({}, { locale });
const english = m.emailsEditorLanguageEnglish({}, { locale });
const status = (view: ReturnType<typeof renderPanel>) =>
  view.getByRole("status").textContent;

test("drops an answer whose language was left before it arrived", async () => {
  const renderer = deferredRenderer();
  const view = renderPanel(renderer.renderPreview);
  await waitFor(() => expect(renderer.requests).toHaveLength(1));
  // Czech was asked for; switching to English outdates it at once.
  act(() => showLanguage("en-US"));
  await act(async () =>
    renderer.requests[0]?.resolve({
      data: { subject: "Czech subject", html: "<p>Czech body</p>" },
    })
  );
  const englishFrame = view.getByTitle(frameTitle(english));
  expect(englishFrame.getAttribute("srcdoc")).toBe("");
  expect(status(view)).toBe(m.emailsEditorPreviewUpdating({}, { locale }));

  await waitFor(() => expect(renderer.requests).toHaveLength(2));
  expect(renderer.requests[1]?.locale).toBe("en-US");
  await act(async () =>
    renderer.requests[1]?.resolve({
      data: { subject: "English subject", html: "<p>English body</p>" },
    })
  );
  expect(englishFrame.getAttribute("srcdoc")).toBe("<p>English body</p>");
  expect(status(view)).toBe(m.emailsEditorPreviewUpdated({}, { locale }));
});

test("drops an answer to a draft edited since, in the same language", async () => {
  const renderer = deferredRenderer();
  const view = renderPanel(renderer.renderPreview);
  await waitFor(() => expect(renderer.requests).toHaveLength(1));
  act(() =>
    form.setValue("translations.cs-CZ.subject", [
      { _tag: "Text", text: "Edited" },
    ])
  );
  await act(async () =>
    renderer.requests[0]?.resolve({
      data: { subject: "Before the edit", html: "<p>Before the edit</p>" },
    })
  );
  expect(view.getByTitle(frameTitle(czech)).getAttribute("srcdoc")).toBe("");
  expect(status(view)).toBe(m.emailsEditorPreviewUpdating({}, { locale }));
  await waitFor(() => expect(renderer.requests).toHaveLength(2));
});

test("a failure clears the earlier picture and shows the server's message", async () => {
  const renderer = deferredRenderer();
  const view = renderPanel(renderer.renderPreview);
  await waitFor(() => expect(renderer.requests).toHaveLength(1));
  await act(async () =>
    renderer.requests[0]?.resolve({
      data: { subject: "Czech subject", html: "<p>Czech body</p>" },
    })
  );
  const czechFrame = view.getByTitle(frameTitle(czech));
  expect(czechFrame.getAttribute("srcdoc")).toBe("<p>Czech body</p>");

  act(() => showLanguage("en-US"));
  await waitFor(() => expect(renderer.requests).toHaveLength(2));
  const serverError = m.emailsActionFailedUnexpectedly({}, { locale });
  await act(async () => renderer.requests[1]?.resolve({ serverError }));
  expect(view.getByRole("alert").textContent).toBe(serverError);
  expect(view.getByTitle(frameTitle(english)).getAttribute("srcdoc")).toBe("");
  expect(status(view)).toBe("");

  act(() => showLanguage("cs-CZ"));
  await waitFor(() => expect(renderer.requests).toHaveLength(3));
  await act(async () => renderer.requests[2]?.reject(new Error("offline")));
  expect(view.getByRole("alert").textContent).toBe(
    m.emailsEditorPreviewFailed({}, { locale })
  );
  expect(view.getByTitle(frameTitle(czech)).getAttribute("srcdoc")).toBe("");
});
