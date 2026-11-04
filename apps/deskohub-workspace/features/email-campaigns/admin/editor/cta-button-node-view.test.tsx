import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { DecorationSet } from "@tiptap/pm/view";
import type { ReactNodeViewProps } from "@tiptap/react";
import { createRef } from "react";
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
const {
  act,
  cleanup,
  fireEvent,
  render,
  renderEditor,
  screen,
  waitFor,
  within,
} = await loadCampaignBodyEditorHarness();
const { CtaButtonNodeView } = await import("./cta-button-node-view");

const locale = "en-US";
/** The button's position: after the 8-position paragraph "Podzim". */
const buttonPosition = 8;

const bodyWithButton = (attrs: CampaignBodyNode["attrs"]) =>
  campaignBodyOf("Podzim", { type: "ctaButton", attrs });

type Rendered = Awaited<ReturnType<typeof renderEditor>>;

const buttonView = ({ view }: Rendered) => {
  const element =
    view.container.querySelector<HTMLElement>("[data-cta-button]");
  if (!element) throw new Error("The button isn't shown");
  return within(element);
};

const editButton = (rendered: Rendered) =>
  buttonView(rendered).queryByRole("button", {
    name: m.emailCampaignsCtaEdit({}, { locale }),
  });

const selectButton = async (rendered: Rendered) => {
  act(() => {
    rendered.editor.commands.setNodeSelection(buttonPosition);
  });
  await waitFor(() => expect(editButton(rendered)).not.toBeNull());
};

const openEditing = async (rendered: Rendered) => {
  await selectButton(rendered);
  await act(async () => {
    fireEvent.click(editButton(rendered)!);
  });
  return within(screen.getByRole("dialog"));
};

const field = (dialog: ReturnType<typeof within>, name: string) =>
  dialog.getByLabelText<HTMLInputElement>(name);
const labelField = (dialog: ReturnType<typeof within>) =>
  field(dialog, m.emailCampaignsCtaLabelLabel({}, { locale }));
const hrefField = (dialog: ReturnType<typeof within>) =>
  field(dialog, m.emailCampaignsCtaHrefLabel({}, { locale }));

const clickIn = async (dialog: ReturnType<typeof within>, name: string) => {
  await act(async () => {
    fireEvent.click(dialog.getByRole("button", { name }));
  });
};

const buttonsOf = (body: CampaignBodyNode | undefined) =>
  (body?.content ?? []).filter(({ type }) => type === "ctaButton");

describe("CtaButtonNodeView", () => {
  afterEach(() => cleanup());
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("shows the button's label and link, with Edit only while it's selected", async () => {
    const rendered = await renderEditor(
      bodyWithButton({ label: "Book now", href: "https://deskohub.test" })
    );

    expect(buttonView(rendered).getByText("Book now")).toBeTruthy();
    expect(
      buttonView(rendered).getByText("https://deskohub.test")
    ).toBeTruthy();
    expect(editButton(rendered)).toBeNull();

    await selectButton(rendered);
    act(() => {
      rendered.editor.commands.setTextSelection(2);
    });

    await waitFor(() => expect(editButton(rendered)).toBeNull());
  });

  test("marks a button that has no label or link yet", async () => {
    const rendered = await renderEditor(
      bodyWithButton({ label: "", href: null })
    );

    expect(
      buttonView(rendered).getByText(
        m.emailCampaignsCtaLabelMissing({}, { locale })
      )
    ).toBeTruthy();
    expect(
      buttonView(rendered).getByText(
        m.emailCampaignsCtaHrefMissing({}, { locale })
      )
    ).toBeTruthy();
  });

  test("offers Edit on the selected button only while the editor is editable", async () => {
    const { editor } = await renderEditor(
      bodyWithButton({ label: "Book now", href: "https://deskohub.test" })
    );
    const node = editor.state.doc.nodeAt(buttonPosition);
    const extension = editor.extensionManager.extensions.find(
      ({ name }) => name === "ctaButton"
    );
    if (!node || !extension) throw new Error("The body has no button");
    const props: ReactNodeViewProps = {
      decorations: [],
      deleteNode: () => {},
      editor,
      extension,
      getPos: () => buttonPosition,
      HTMLAttributes: {},
      innerDecorations: DecorationSet.empty,
      node,
      ref: createRef(),
      selected: true,
      updateAttributes: () => {},
      view: editor.view,
    };
    const editShown = () => {
      const nodeView = render(<CtaButtonNodeView {...props} />);
      const shown =
        nodeView.queryByRole("button", {
          name: m.emailCampaignsCtaEdit({}, { locale }),
        }) !== null;
      nodeView.unmount();
      return shown;
    };

    expect(editShown()).toBe(true);
    editor.setEditable(false);
    expect(editShown()).toBe(false);
  });

  test("edits the button with its label trimmed and its link completed", async () => {
    const rendered = await renderEditor(
      bodyWithButton({ label: "Book now", href: "https://deskohub.test" })
    );
    const dialog = await openEditing(rendered);

    expect(labelField(dialog).value).toBe("Book now");
    expect(hrefField(dialog).value).toBe("https://deskohub.test");
    fireEvent.input(labelField(dialog), { target: { value: "  Reserve  " } });
    fireEvent.input(hrefField(dialog), {
      target: { value: "workspace.deskohub.cz" },
    });
    await clickIn(dialog, m.emailCampaignsCtaUpdate({}, { locale }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(buttonsOf(rendered.changes.at(-1))).toEqual([
      {
        type: "ctaButton",
        attrs: { label: "Reserve", href: "https://workspace.deskohub.cz" },
      },
    ]);
  });

  test("refuses a missing label and a link campaigns can't use", async () => {
    const rendered = await renderEditor(
      bodyWithButton({ label: "Book now", href: "https://deskohub.test" })
    );
    const dialog = await openEditing(rendered);

    fireEvent.input(labelField(dialog), { target: { value: "   " } });
    fireEvent.input(hrefField(dialog), {
      target: { value: "http://deskohub.test" },
    });
    await clickIn(dialog, m.emailCampaignsCtaUpdate({}, { locale }));

    await waitFor(() =>
      expect(
        dialog.getByText(m.emailCampaignsCtaLabelRequired({}, { locale }))
      ).toBeTruthy()
    );
    expect(
      dialog.getByText(m.emailCampaignsLinkHrefHint({}, { locale }))
    ).toBeTruthy();
    expect(rendered.changes).toEqual([]);
  });

  test("cancels editing without changing the button", async () => {
    const rendered = await renderEditor(
      bodyWithButton({ label: "Book now", href: "https://deskohub.test" })
    );
    const dialog = await openEditing(rendered);

    fireEvent.input(labelField(dialog), { target: { value: "Reserve" } });
    await clickIn(dialog, m.emailCampaignsCtaCancel({}, { locale }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(rendered.changes).toEqual([]);
    expect(buttonView(rendered).getByText("Book now")).toBeTruthy();
  });

  test("removes the button", async () => {
    const rendered = await renderEditor(
      bodyWithButton({ label: "Book now", href: "https://deskohub.test" })
    );
    const dialog = await openEditing(rendered);

    await clickIn(dialog, m.emailCampaignsCtaRemove({}, { locale }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(buttonsOf(rendered.changes.at(-1))).toEqual([]);
    expect(
      rendered.view.container.querySelector("[data-cta-button]")
    ).toBeNull();
  });
});
