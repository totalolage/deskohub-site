import { afterAll, afterEach, expect, test } from "bun:test";
import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { EmailDraft } from "@deskohub/workspace-admin-api";
import type { Editor } from "@tiptap/core";
import type { ReactNode } from "react";
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
const { act, cleanup, fireEvent, render, waitFor } = await import(
  "@testing-library/react"
);
const { EmailEditorProvider } = await import("./email-editor-context");
const { emailEditorFieldIds, emailEditorProblemsId } = await import(
  "./email-editor-field-ids"
);
const { EmailInlineTextField } = await import("./email-inline-text-field");

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

const locale = "en-US";
const contentLocale = "cs-CZ";
const subjectId = emailEditorFieldIds.translation(contentLocale, "subject");
const discount = {
  name: "sleva",
  source: {
    kind: "discount",
    discountId: "8b0f5a52-7a3c-4c11-9f0e-2b4d7f1e6a90",
    validDays: 14,
  },
} as const;

type DraftForm = UseFormReturn<EmailDraftFormValues, unknown, EmailDraft>;

function Host({
  children,
  defaultValues,
  onForm,
}: {
  readonly children: ReactNode;
  readonly defaultValues: EmailDraftFormValues;
  readonly onForm: (form: DraftForm) => void;
}) {
  const form = useForm<EmailDraftFormValues, unknown, EmailDraft>({
    resolver: effectSchemaResolver(EmailDraft),
    defaultValues,
  });
  onForm(form);
  return (
    <RouteLocaleProvider locale={locale}>
      <FormProvider {...form}>
        <EmailEditorProvider locales={[contentLocale]}>
          {children}
        </EmailEditorProvider>
      </FormProvider>
    </RouteLocaleProvider>
  );
}

const renderSubject = async ({
  mode = "rich",
  links,
  values = {},
}: {
  readonly mode?: "rich" | "plain";
  readonly links?: Readonly<Record<string, string>>;
  readonly values?: EmailDraftFormValues;
} = {}) => {
  let form: DraftForm | undefined;
  const view = render(
    <Host
      defaultValues={values}
      onForm={(next) => {
        form = next;
      }}
    >
      <EmailInlineTextField
        contentLocale={contentLocale}
        fieldId={subjectId}
        label="Subject"
        links={links}
        mode={mode}
        target={{ kind: "subject" }}
      />
    </Host>
  );
  const editor = await waitFor(() => {
    const element = view.container.querySelector<
      HTMLElement & { editor?: Editor }
    >(".ProseMirror");
    if (!element?.editor) throw new Error("The editor has not started");
    return element.editor;
  });
  const subject = () =>
    form?.getValues(`translations.${contentLocale}.subject`);
  const textbox = () => view.getByRole("textbox", { name: "Subject" });
  return { view, editor, subject, textbox, form: () => form! };
};

/** Types at the caret, as ProseMirror does for keyboard input. */
const type = (editor: Editor, text: string) =>
  act(() => {
    editor.view.dispatch(editor.state.tr.insertText(text));
  });

test("names the control and writes typed text to the form", async () => {
  const { editor, subject, textbox } = await renderSubject();

  expect(textbox().id).toBe(subjectId);
  expect(textbox().getAttribute("lang")).toBe(contentLocale);
  expect(textbox().getAttribute("aria-multiline")).toBe("false");
  type(editor, "Ahoj");

  expect(subject()).toEqual([{ _tag: "Text", text: "Ahoj" }]);
});

test("toggles bold and italic on the selection", async () => {
  const { editor, subject, view } = await renderSubject({
    values: {
      translations: {
        [contentLocale]: { subject: [{ _tag: "Text", text: "Dobrý den" }] },
      },
    },
  });
  const bold = view.getByRole("button", {
    name: m.emailsEditorInlineBold({}, { locale }),
  });
  const italic = view.getByRole("button", {
    name: m.emailsEditorInlineItalic({}, { locale }),
  });

  act(() => {
    editor.commands.setTextSelection({ from: 1, to: 6 });
  });
  fireEvent.click(bold);
  await waitFor(() => expect(bold.getAttribute("aria-pressed")).toBe("true"));
  fireEvent.click(italic);

  expect(subject()).toEqual([
    { _tag: "Text", text: "Dobrý", bold: true, italic: true },
    { _tag: "Text", text: " den" },
  ]);
  await waitFor(() => expect(italic.getAttribute("aria-pressed")).toBe("true"));
});

test("links the selection to one of the block's destinations by key", async () => {
  const { editor, subject, view } = await renderSubject({
    links: { web: "https://deskohub.cz", shop: "https://deskohub.cz/shop" },
    values: {
      translations: {
        [contentLocale]: { subject: [{ _tag: "Text", text: "Naše stránky" }] },
      },
    },
  });
  const linkLabel = m.emailsEditorInlineLink({}, { locale });

  act(() => {
    editor.commands.setTextSelection({ from: 6, to: 13 });
  });
  fireEvent.keyDown(view.getByRole("button", { name: linkLabel }), {
    key: "Enter",
  });
  fireEvent.click(
    await view.findByRole("menuitemcheckbox", {
      name: "https://deskohub.cz/shop",
    })
  );

  expect(subject()).toEqual([
    { _tag: "Text", text: "Naše " },
    { _tag: "Text", text: "stránky", link: "shop" },
  ]);

  act(() => {
    editor.commands.setTextSelection(8);
  });
  fireEvent.keyDown(view.getByRole("button", { name: linkLabel }), {
    key: "Enter",
  });
  fireEvent.click(
    await view.findByRole("menuitem", {
      name: m.emailsEditorInlineLinkRemove({}, { locale }),
    })
  );

  expect(subject()).toEqual([{ _tag: "Text", text: "Naše stránky" }]);
});

test("explains the link control when the block has no destinations", async () => {
  const { view } = await renderSubject();
  const link = view.getByRole("button", {
    name: m.emailsEditorInlineLink({}, { locale }),
  });

  expect(link.getAttribute("aria-disabled")).toBe("true");
  const hint = document.getElementById(
    link.getAttribute("aria-describedby") ?? ""
  );
  expect(hint?.textContent).toBe(m.emailsEditorInlineLinkNone({}, { locale }));
  fireEvent.keyDown(link, { key: "Enter" });
  expect(view.queryByRole("menu")).toBeNull();
});

test("inserts a value chip, writes a value part and returns focus", async () => {
  const { editor, subject, view } = await renderSubject({
    values: {
      values: [discount],
      translations: {
        [contentLocale]: { subject: [{ _tag: "Text", text: "Kód " }] },
      },
    },
  });

  act(() => {
    editor.commands.setTextSelection(5);
  });
  fireEvent.click(
    view.getByRole("button", {
      name: m.emailsEditorInlineValueInsert({}, { locale }),
    })
  );
  const option = await view.findByRole("option", { name: /sleva\.code/ });
  expect(option.textContent).toContain(
    m.emailsEditorInlineValueDiscountCode({}, { locale })
  );
  fireEvent.click(option);

  expect(subject()).toEqual([
    { _tag: "Text", text: "Kód " },
    { _tag: "Value", name: "sleva", field: ["code"] },
  ]);
  const chip = view.container.querySelector("[data-email-value]");
  expect(chip?.textContent).toBe("sleva.code");
  expect(chip?.getAttribute("contenteditable")).toBe("false");
  expect(chip?.hasAttribute("data-missing")).toBe(false);
  await waitFor(() => expect(document.activeElement?.id).toBe(subjectId));
});

test("shows a reference to a value no definition names as missing", async () => {
  const { form, view } = await renderSubject({
    values: {
      values: [discount],
      translations: {
        [contentLocale]: {
          subject: [
            { _tag: "Value", name: "sleva", field: ["code"] },
            { _tag: "Value", name: "zruseno" },
          ],
        },
      },
    },
  });
  const chips = () =>
    [...view.container.querySelectorAll("[data-email-value]")].map((chip) =>
      chip.hasAttribute("data-missing")
    );

  await waitFor(() => expect(chips()).toEqual([false, true]));
  act(() => {
    form().setValue("values", []);
  });
  await waitFor(() => expect(chips()).toEqual([true, true]));
  act(() => {
    form().setValue("values", [discount, { name: "zruseno" }]);
  });
  await waitFor(() => expect(chips()).toEqual([false, false]));
});

test("shows the form's new value after a host reset without writing back", async () => {
  const { editor, form, subject, textbox } = await renderSubject({
    values: {
      translations: {
        [contentLocale]: { subject: [{ _tag: "Text", text: "Před" }] },
      },
    },
  });
  type(editor, "Upraveno ");
  const writes: (string | undefined)[] = [];
  const watching = form().watch((_values, { name }) => writes.push(name));

  act(() => {
    form().reset({
      translations: {
        [contentLocale]: {
          subject: [{ _tag: "Text", text: "Po resetu", bold: true }],
        },
      },
    });
  });

  await waitFor(() => expect(textbox().textContent).toBe("Po resetu"));
  expect(textbox().querySelector("strong")?.textContent).toBe("Po resetu");
  expect(subject()).toEqual([{ _tag: "Text", text: "Po resetu", bold: true }]);
  // Only the reset itself changed the form; the editor wrote nothing back.
  expect(writes.filter((name) => name !== undefined)).toEqual([]);
  watching.unsubscribe();
  // The replaced text is gone from the undo history too.
  act(() => {
    editor.commands.undo();
  });
  expect(textbox().textContent).toBe("Po resetu");
});

test("keeps the text on one line", async () => {
  const { editor, subject } = await renderSubject({
    values: {
      translations: {
        [contentLocale]: { subject: [{ _tag: "Text", text: "Jedna" }] },
      },
    },
  });

  act(() => {
    editor.commands.setTextSelection(6);
  });
  fireEvent.keyDown(editor.view.dom, { key: "Enter" });
  act(() => {
    editor.view.pasteText(" dva\ntři\r\nčtyři");
  });

  expect(editor.state.doc.childCount).toBe(1);
  expect(subject()).toEqual([{ _tag: "Text", text: "Jedna dva tři čtyři" }]);
});

test("plain texts offer only values and drop pasted formatting", async () => {
  const { editor, subject, view } = await renderSubject({ mode: "plain" });

  for (const name of [
    m.emailsEditorInlineBold({}, { locale }),
    m.emailsEditorInlineItalic({}, { locale }),
    m.emailsEditorInlineLink({}, { locale }),
  ])
    expect(view.queryByRole("button", { name })).toBeNull();
  expect(
    view.getByRole("button", {
      name: m.emailsEditorInlineValueInsert({}, { locale }),
    })
  ).toBeDefined();

  act(() => {
    editor.view.pasteHTML(
      "<p><strong>Tučně</strong> a <em>kurzívou</em></p><p><a href='https://deskohub.cz'>odkaz</a></p>"
    );
  });

  expect(subject()).toEqual([{ _tag: "Text", text: "Tučně a kurzívou odkaz" }]);
});

test("ties invalid state and problem messages to the control as they change", async () => {
  const { editor, textbox, view } = await renderSubject();
  const problemsId = emailEditorProblemsId(subjectId);

  expect(textbox().getAttribute("aria-invalid")).toBe("true");
  expect(textbox().getAttribute("aria-describedby")).toBe(problemsId);
  expect(view.container.querySelector(`[id="${problemsId}"]`)).not.toBeNull();

  type(editor, "Předmět");

  await waitFor(() =>
    expect(textbox().hasAttribute("aria-invalid")).toBe(false)
  );
  expect(textbox().hasAttribute("aria-describedby")).toBe(false);
  expect(view.container.querySelector(`[id="${problemsId}"]`)).toBeNull();
});

const subjectOf = (text: string) =>
  ({
    translations: { [contentLocale]: { subject: [{ _tag: "Text", text }] } },
  }) satisfies EmailDraftFormValues;

test("follows a reset that lands together with typing", async () => {
  const { editor, form, subject, textbox } = await renderSubject({
    values: subjectOf("A"),
  });

  act(() => {
    editor.view.dispatch(editor.state.tr.insertText("B", 2));
    form().reset(subjectOf("A"));
  });

  await waitFor(() => expect(textbox().textContent).toBe("A"));
  expect(subject()).toEqual([{ _tag: "Text", text: "A" }]);
});

test("a reset leaves nothing to undo or redo", async () => {
  const { editor, form, textbox } = await renderSubject({
    values: subjectOf("Starý"),
  });

  // Typing over the whole text, then a reset: Undo keeps the reset text.
  act(() => {
    editor.view.dispatch(
      editor.state.tr.insertText("Nový", 1, editor.state.doc.content.size - 1)
    );
  });
  act(() => {
    form().reset(subjectOf("Po resetu"));
  });
  await waitFor(() => expect(textbox().textContent).toBe("Po resetu"));
  act(() => {
    editor.commands.undo();
  });
  expect(textbox().textContent).toBe("Po resetu");

  // An undone edit, then a reset: Redo keeps the reset text.
  type(editor, "!");
  act(() => {
    editor.commands.undo();
  });
  act(() => {
    form().reset(subjectOf("Znovu"));
  });
  await waitFor(() => expect(textbox().textContent).toBe("Znovu"));
  act(() => {
    editor.commands.redo();
  });
  expect(textbox().textContent).toBe("Znovu");
});

test("removes a link whose destination the block no longer has", async () => {
  const { editor, subject, view } = await renderSubject({
    values: {
      translations: {
        [contentLocale]: {
          subject: [{ _tag: "Text", text: "Odkaz", link: "smazany" }],
        },
      },
    },
  });

  act(() => {
    editor.commands.setTextSelection(3);
  });
  fireEvent.keyDown(
    view.getByRole("button", {
      name: m.emailsEditorInlineLink({}, { locale }),
    }),
    { key: "Enter" }
  );
  fireEvent.click(
    await view.findByRole("menuitem", {
      name: m.emailsEditorInlineLinkRemove({}, { locale }),
    })
  );

  expect(subject()).toEqual([{ _tag: "Text", text: "Odkaz" }]);
});

test("shows stored line breaks and plain-text formatting as the text will be saved", async () => {
  const { editor, subject, textbox } = await renderSubject({
    mode: "plain",
    values: {
      translations: {
        [contentLocale]: {
          subject: [
            { _tag: "Text", text: "První\nřádek", bold: true },
            { _tag: "Value", name: "sleva", field: ["code"], italic: true },
          ],
        },
      },
    },
  });

  expect(textbox().textContent).toBe("První řádeksleva.code");
  expect(textbox().querySelector("strong, em")).toBeNull();
  // The form keeps the stored text until it is edited.
  expect(subject()).toEqual([
    { _tag: "Text", text: "První\nřádek", bold: true },
    { _tag: "Value", name: "sleva", field: ["code"], italic: true },
  ]);

  act(() => {
    editor.commands.setTextSelection(1);
  });
  type(editor, "> ");

  expect(subject()).toEqual([
    { _tag: "Text", text: "> První řádek" },
    { _tag: "Value", name: "sleva", field: ["code"] },
  ]);
});

test("keeps copied value chips and formatting when pasted into a rich text", async () => {
  const { editor, subject } = await renderSubject();

  act(() => {
    editor.view.pasteHTML(
      `<p>Kód <strong>tučně <span data-email-value="" data-name="sleva" data-field='["code"]'>sleva.code</span></strong></p><p><em>dál</em></p>`
    );
  });

  expect(subject()).toEqual([
    { _tag: "Text", text: "Kód " },
    { _tag: "Text", text: "tučně ", bold: true },
    { _tag: "Value", name: "sleva", field: ["code"], bold: true },
    { _tag: "Text", text: " " },
    { _tag: "Text", text: "dál", italic: true },
  ]);
});

test("shows the new text when the field switches to another text", async () => {
  const values = {
    translations: {
      [contentLocale]: {
        subject: [{ _tag: "Text", text: "Předmět" }],
        preheader: [{ _tag: "Text", text: "Úvod", italic: true }],
      },
    },
  } satisfies EmailDraftFormValues;
  let form: DraftForm | undefined;
  const field = (target: "subject" | "preheader") => (
    <Host
      defaultValues={values}
      onForm={(next) => {
        form = next;
      }}
    >
      <EmailInlineTextField
        contentLocale={contentLocale}
        fieldId={subjectId}
        label="Text"
        mode="rich"
        target={{ kind: target }}
      />
    </Host>
  );
  const view = render(field("subject"));
  const textbox = () => view.getByRole("textbox", { name: "Text" });
  await waitFor(() => expect(textbox().textContent).toBe("Předmět"));

  view.rerender(field("preheader"));

  await waitFor(() => expect(textbox().textContent).toBe("Úvod"));
  expect(textbox().querySelector("em")?.textContent).toBe("Úvod");
  expect(form?.getValues(`translations.${contentLocale}`)).toEqual(
    values.translations[contentLocale]
  );
});
