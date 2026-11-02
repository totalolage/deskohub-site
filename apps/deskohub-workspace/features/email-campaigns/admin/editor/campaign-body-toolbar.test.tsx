import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { m } from "@/features/administration/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { CampaignBodyNode } from "../../body/campaign-body-document";
import {
  campaignBodyOf,
  loadCampaignBodyEditorHarness,
} from "./campaign-body-editor.test-utils";

registerWorkspaceComponentTestEnv();
const { act, cleanup, fireEvent, renderEditor, screen, waitFor, within } =
  await loadCampaignBodyEditorHarness();

const locale = "en-US";

type Rendered = Awaited<ReturnType<typeof renderEditor>>;
type Scope = ReturnType<typeof within>;

const toolbarOf = ({ view }: Rendered) => within(view.getByRole("toolbar"));

const control = (rendered: Rendered, name: string) =>
  toolbarOf(rendered).getByRole("button", { name });

const press = async (rendered: Rendered, name: string) => {
  await act(async () => {
    fireEvent.click(control(rendered, name));
  });
};

const pressed = (rendered: Rendered, name: string) =>
  control(rendered, name).getAttribute("aria-pressed");

const select = (rendered: Rendered, from: number, to = from) =>
  act(() => {
    rendered.editor.commands.setTextSelection({ from, to });
  });

/** The body's top-level blocks, by type. */
const blockTypes = (rendered: Rendered) =>
  (rendered.editor.getJSON().content ?? []).map(({ type }) => type);

const firstBlock = (rendered: Rendered) =>
  rendered.editor.getJSON().content?.[0] as CampaignBodyNode | undefined;

const labels = {
  bold: m.emailCampaignsEditorBold({}, { locale }),
  italic: m.emailCampaignsEditorItalic({}, { locale }),
  bulletList: m.emailCampaignsEditorBulletList({}, { locale }),
  numberedList: m.emailCampaignsEditorNumberedList({}, { locale }),
  divider: m.emailCampaignsEditorDivider({}, { locale }),
  undo: m.emailCampaignsEditorUndo({}, { locale }),
  redo: m.emailCampaignsEditorRedo({}, { locale }),
  link: m.emailCampaignsLinkToggle({}, { locale }),
  ctaInsert: m.emailCampaignsCtaInsert({}, { locale }),
  ctaEdit: m.emailCampaignsCtaEdit({}, { locale }),
};

const textStyle = (rendered: Rendered) =>
  toolbarOf(rendered).getByRole("combobox", {
    name: m.emailCampaignsEditorTextStyle({}, { locale }),
  });

const chooseTextStyle = async (rendered: Rendered, option: string) => {
  await act(async () => {
    fireEvent.keyDown(textStyle(rendered), { key: "Enter" });
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("option", { name: option }));
  });
};

const openLink = async (rendered: Rendered) => {
  await press(rendered, labels.link);
  return within(screen.getByRole("dialog"));
};

const linkField = (popover: Scope) =>
  popover.getByLabelText<HTMLInputElement>(
    m.emailCampaignsLinkHrefLabel({}, { locale })
  );

const enterLink = async (popover: Scope, href: string) => {
  fireEvent.change(linkField(popover), { target: { value: href } });
  await act(async () => {
    fireEvent.keyDown(linkField(popover), { key: "Enter" });
  });
};

const ctaField = (dialog: Scope, name: string) =>
  dialog.getByLabelText<HTMLInputElement>(name);

const submitCta = async (
  dialog: Scope,
  submit: string,
  values: { readonly label: string; readonly href: string }
) => {
  fireEvent.input(
    ctaField(dialog, m.emailCampaignsCtaLabelLabel({}, { locale })),
    { target: { value: values.label } }
  );
  fireEvent.input(
    ctaField(dialog, m.emailCampaignsCtaHrefLabel({}, { locale })),
    { target: { value: values.href } }
  );
  await act(async () => {
    fireEvent.click(dialog.getByRole("button", { name: submit }));
  });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
};

const ctaButtons = (rendered: Rendered) =>
  (rendered.editor.getJSON().content ?? []).filter(
    ({ type }) => type === "ctaButton"
  );

describe("CampaignBodyToolbar", () => {
  afterEach(() => cleanup());
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("switches the text style between headings and a paragraph", async () => {
    const rendered = await renderEditor(campaignBodyOf("Podzim"));
    select(rendered, 2);

    expect(textStyle(rendered).textContent).toBe(
      m.emailCampaignsEditorParagraph({}, { locale })
    );
    await chooseTextStyle(
      rendered,
      m.emailCampaignsEditorHeading2({}, { locale })
    );

    expect(firstBlock(rendered)).toMatchObject({
      type: "heading",
      attrs: { level: 2 },
    });
    await waitFor(() =>
      expect(textStyle(rendered).textContent).toBe(
        m.emailCampaignsEditorHeading2({}, { locale })
      )
    );

    await chooseTextStyle(
      rendered,
      m.emailCampaignsEditorParagraph({}, { locale })
    );

    expect(firstBlock(rendered)?.type).toBe("paragraph");
  });

  test("toggles bold and italic on the selection and shows them pressed", async () => {
    const rendered = await renderEditor(campaignBodyOf("Podzim"));
    select(rendered, 1, 7);

    expect(pressed(rendered, labels.bold)).toBe("false");
    await press(rendered, labels.bold);
    await press(rendered, labels.italic);

    expect(firstBlock(rendered)?.content?.[0]?.marks).toEqual([
      { type: "bold" },
      { type: "italic" },
    ]);
    await waitFor(() => expect(pressed(rendered, labels.bold)).toBe("true"));
    expect(pressed(rendered, labels.italic)).toBe("true");
  });

  test("turns the paragraph into a bulleted or a numbered list", async () => {
    const rendered = await renderEditor(campaignBodyOf("Podzim"));
    select(rendered, 2);

    await press(rendered, labels.bulletList);
    expect(blockTypes(rendered)).toEqual(["bulletList"]);
    await waitFor(() =>
      expect(pressed(rendered, labels.bulletList)).toBe("true")
    );

    await press(rendered, labels.numberedList);
    expect(blockTypes(rendered)).toEqual(["orderedList"]);
    await waitFor(() =>
      expect(pressed(rendered, labels.numberedList)).toBe("true")
    );
    expect(pressed(rendered, labels.bulletList)).toBe("false");
  });

  test("inserts a divider", async () => {
    const rendered = await renderEditor(campaignBodyOf("Podzim"));
    select(rendered, 7);

    await press(rendered, labels.divider);

    expect(blockTypes(rendered)).toContain("horizontalRule");
  });

  test("undoes and redoes a change, each offered only when possible", async () => {
    const rendered = await renderEditor(campaignBodyOf("Podzim"));
    select(rendered, 1, 7);

    expect(control(rendered, labels.undo).hasAttribute("disabled")).toBe(true);
    expect(control(rendered, labels.redo).hasAttribute("disabled")).toBe(true);
    await press(rendered, labels.bold);
    await waitFor(() =>
      expect(control(rendered, labels.undo).hasAttribute("disabled")).toBe(
        false
      )
    );

    await press(rendered, labels.undo);
    expect(firstBlock(rendered)?.content?.[0]?.marks).toBeUndefined();
    await waitFor(() =>
      expect(control(rendered, labels.redo).hasAttribute("disabled")).toBe(
        false
      )
    );

    await press(rendered, labels.redo);
    expect(firstBlock(rendered)?.content?.[0]?.marks).toEqual([
      { type: "bold" },
    ]);
  });

  test("inserts a typed address as a mailto: link where nothing is selected", async () => {
    const rendered = await renderEditor(campaignBodyOf("Podzim "));
    select(rendered, 8);
    const popover = await openLink(rendered);

    expect(linkField(popover).value).toBe("");
    const address = testEmailAddress("team");
    await enterLink(popover, address);

    expect(firstBlock(rendered)?.content?.at(-1)).toEqual({
      type: "text",
      text: address,
      marks: [
        {
          type: "link",
          attrs: expect.objectContaining({ href: `mailto:${address}` }),
        },
      ],
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("links the selected text, completing a bare host", async () => {
    const rendered = await renderEditor(campaignBodyOf("Podzim"));
    select(rendered, 1, 7);
    const popover = await openLink(rendered);

    fireEvent.change(linkField(popover), {
      target: { value: "workspace.deskohub.cz" },
    });
    await act(async () => {
      fireEvent.click(
        popover.getByRole("button", {
          name: m.emailCampaignsLinkAdd({}, { locale }),
        })
      );
    });

    expect(firstBlock(rendered)?.content).toEqual([
      {
        type: "text",
        text: "Podzim",
        marks: [
          {
            type: "link",
            attrs: expect.objectContaining({
              href: "https://workspace.deskohub.cz",
            }),
          },
        ],
      },
    ]);
  });

  test("refuses a link campaigns can't use until it's corrected", async () => {
    const rendered = await renderEditor(campaignBodyOf("Podzim"));
    select(rendered, 1, 7);
    const popover = await openLink(rendered);

    await enterLink(popover, "http://deskohub.test");

    expect(popover.getByRole("alert").textContent).toBe(
      m.emailCampaignsLinkHrefHint({}, { locale })
    );
    expect(linkField(popover).getAttribute("aria-invalid")).toBe("true");
    expect(firstBlock(rendered)?.content?.[0]?.marks).toBeUndefined();

    fireEvent.change(linkField(popover), {
      target: { value: "https://deskohub.test" },
    });
    expect(popover.getByRole("alert").textContent).toBe("");
  });

  test("updates or removes the link at the cursor", async () => {
    const rendered = await renderEditor(campaignBodyOf("Podzim"));
    act(() => {
      rendered.editor
        .chain()
        .setTextSelection({ from: 1, to: 7 })
        .setLink({ href: "https://deskohub.test" })
        .setTextSelection(3)
        .run();
    });
    await waitFor(() => expect(pressed(rendered, labels.link)).toBe("true"));

    let popover = await openLink(rendered);
    expect(linkField(popover).value).toBe("https://deskohub.test");
    fireEvent.change(linkField(popover), {
      target: { value: "https://workspace.deskohub.cz" },
    });
    await act(async () => {
      fireEvent.click(
        popover.getByRole("button", {
          name: m.emailCampaignsLinkUpdate({}, { locale }),
        })
      );
    });
    expect(firstBlock(rendered)?.content).toEqual([
      expect.objectContaining({
        text: "Podzim",
        marks: [
          expect.objectContaining({
            attrs: expect.objectContaining({
              href: "https://workspace.deskohub.cz",
            }),
          }),
        ],
      }),
    ]);

    popover = await openLink(rendered);
    await act(async () => {
      fireEvent.click(
        popover.getByRole("button", {
          name: m.emailCampaignsLinkRemove({}, { locale }),
        })
      );
    });

    expect(firstBlock(rendered)?.content).toEqual([
      { type: "text", text: "Podzim" },
    ]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("offers no link removal where there's no link", async () => {
    const rendered = await renderEditor(campaignBodyOf("Podzim"));
    select(rendered, 1, 7);
    const popover = await openLink(rendered);

    expect(
      popover.queryByRole("button", {
        name: m.emailCampaignsLinkRemove({}, { locale }),
      })
    ).toBeNull();
  });

  test("inserts a CTA button, then edits and removes the selected one", async () => {
    const rendered = await renderEditor(campaignBodyOf("Podzim"));
    select(rendered, 7);

    await press(rendered, labels.ctaInsert);
    let dialog = within(screen.getByRole("dialog"));
    expect(
      ctaField(dialog, m.emailCampaignsCtaLabelLabel({}, { locale })).value
    ).toBe("");
    expect(
      dialog.queryByRole("button", {
        name: m.emailCampaignsCtaRemove({}, { locale }),
      })
    ).toBeNull();
    await submitCta(dialog, labels.ctaInsert, {
      label: " Book now ",
      href: "deskohub.test",
    });

    expect(ctaButtons(rendered)).toEqual([
      {
        type: "ctaButton",
        attrs: { label: "Book now", href: "https://deskohub.test" },
      },
    ]);

    act(() => {
      rendered.editor.commands.setNodeSelection(8);
    });
    await waitFor(() => expect(control(rendered, labels.ctaEdit)).toBeTruthy());
    await press(rendered, labels.ctaEdit);
    dialog = within(screen.getByRole("dialog"));
    expect(
      ctaField(dialog, m.emailCampaignsCtaHrefLabel({}, { locale })).value
    ).toBe("https://deskohub.test");
    await submitCta(dialog, m.emailCampaignsCtaUpdate({}, { locale }), {
      label: "Reserve",
      href: "https://workspace.deskohub.cz",
    });

    expect(ctaButtons(rendered)).toEqual([
      {
        type: "ctaButton",
        attrs: { label: "Reserve", href: "https://workspace.deskohub.cz" },
      },
    ]);

    await press(rendered, labels.ctaEdit);
    dialog = within(screen.getByRole("dialog"));
    await act(async () => {
      fireEvent.click(
        dialog.getByRole("button", {
          name: m.emailCampaignsCtaRemove({}, { locale }),
        })
      );
    });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(ctaButtons(rendered)).toEqual([]);
  });
});
