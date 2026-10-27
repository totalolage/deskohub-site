import { afterAll, afterEach, expect, mock, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { m } from "@/features/administration/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { CampaignBodyNode } from "../../body/campaign-body-document";

registerWorkspaceComponentTestEnv();

const uploadCampaignImage = mock(async (_form: FormData) => ({
  data: {
    url: "https://res.cloudinary.com/cloud/image/upload/v1/campaigns/new.png",
    width: 640,
  },
}));

mock.module("@/features/email-campaigns/admin/editor/actions", () => ({
  uploadCampaignImage,
}));

const { CampaignBodyEditor } = await import("./campaign-body-editor");
const { campaignImageMaxBytes } = await import("./campaign-image-upload");

afterEach(() => {
  cleanup();
  uploadCampaignImage.mockClear();
});
afterAll(unregisterWorkspaceComponentTestEnv);

const locale = "en-US";

const cloudinaryImage =
  "https://res.cloudinary.com/cloud/image/upload/v1/campaigns/autumn.jpg";

/** A paragraph, then at position 8 an image with these attributes. */
const bodyWithImage = (
  attrs: CampaignBodyNode["attrs"] = { width: 480 }
): CampaignBodyNode => ({
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Podzim" }] },
    {
      type: "image",
      attrs: { src: cloudinaryImage, alt: "Zasedačka", title: null, ...attrs },
    },
  ],
});

const alignmentLabels = [
  m.emailCampaignsImageAlignLeft({}, { locale }),
  m.emailCampaignsImageAlignCenter({}, { locale }),
  m.emailCampaignsImageAlignRight({}, { locale }),
];

const renderEditor = async (value = bodyWithImage()) => {
  const changes: CampaignBodyNode[] = [];
  const view = render(
    <CampaignBodyEditor
      contentLocale="cs-CZ"
      label="Body"
      onChange={(doc) => changes.push(doc)}
      value={value}
    />
  );
  const editor = await waitFor(() => {
    const element = view.container.querySelector<
      HTMLElement & { editor?: Editor }
    >(".ProseMirror");
    if (!element?.editor) throw new Error("The editor has not started");
    return element.editor;
  });
  const alignmentButtons = () =>
    alignmentLabels.flatMap((name) => view.queryAllByRole("button", { name }));
  return { view, editor, changes, alignmentButtons };
};

type CampaignBodyPart =
  | CampaignBodyNode
  | NonNullable<CampaignBodyNode["attrs"]>
  | NonNullable<CampaignBodyNode["content"]>
  | NonNullable<CampaignBodyNode["marks"]>[number];

const isPlain = (value: CampaignBodyPart) =>
  [Object.prototype, Array.prototype].includes(Object.getPrototypeOf(value));

/**
 * The parts of a body a Server Action can't receive: anything but plain
 * objects and arrays, such as ProseMirror's null-prototype attributes.
 */
const nonPlainParts = (node: CampaignBodyNode, path = "doc"): string[] => [
  ...[node, node.attrs, node.content]
    .filter((part) => part !== undefined && !isPlain(part))
    .map(() => path),
  ...(node.marks ?? [])
    .filter((mark) => !isPlain(mark) || (mark.attrs && !isPlain(mark.attrs)))
    .map((_, index) => `${path}.marks.${index}`),
  ...(node.content ?? []).flatMap((child, index) =>
    nonPlainParts(child, `${path}.content.${index}`)
  ),
];

test("hands the form plain objects a Server Action can receive", async () => {
  const { editor, changes } = await renderEditor();

  act(() => {
    editor
      .chain()
      .setNodeSelection(8)
      .updateAttributes("image", {
        align: "left",
      })
      .run();
  });

  const latest = changes.at(-1);
  expect(latest?.content?.[1]?.attrs).toMatchObject({ align: "left" });
  expect(latest && nonPlainParts(latest)).toEqual([]);
});

test("shows the alignment controls only while an image is selected", async () => {
  const { editor, alignmentButtons } = await renderEditor();

  expect(alignmentButtons()).toEqual([]);

  act(() => {
    editor.commands.setNodeSelection(8);
  });
  await waitFor(() => expect(alignmentButtons()).toHaveLength(3));
  expect(
    alignmentButtons().map((button) => button.getAttribute("aria-pressed"))
  ).toEqual(["false", "true", "false"]);

  act(() => {
    editor.commands.setTextSelection(2);
  });
  await waitFor(() => expect(alignmentButtons()).toEqual([]));
});

test("aligns the selected image and keeps its width", async () => {
  const { editor, changes, alignmentButtons } = await renderEditor();

  act(() => {
    editor.commands.setNodeSelection(8);
  });
  await waitFor(() => expect(alignmentButtons()).toHaveLength(3));
  fireEvent.click(alignmentButtons()[2]!);

  expect(changes.at(-1)?.content?.[1]?.attrs).toMatchObject({
    align: "right",
    width: 480,
  });
});

test("inserts an uploaded image centered at its width", async () => {
  const { view, changes } = await renderEditor();
  const input =
    view.container.querySelector<HTMLInputElement>('input[type="file"]');

  fireEvent.change(input!, {
    target: {
      files: [new File([new Uint8Array(3)], "new.png", { type: "image/png" })],
    },
  });

  await waitFor(() =>
    expect(changes.at(-1)?.content).toContainEqual(
      expect.objectContaining({
        type: "image",
        attrs: expect.objectContaining({ align: "center", width: 640 }),
      })
    )
  );
});

test("refuses an image too large to upload before sending it", async () => {
  const { view } = await renderEditor();
  const input =
    view.container.querySelector<HTMLInputElement>('input[type="file"]');

  const tooLarge = new File([new Uint8Array(3)], "big.png", {
    type: "image/png",
  });
  // A real file this size makes the DOM shim crawl; only its size matters.
  Object.defineProperty(tooLarge, "size", { value: campaignImageMaxBytes + 1 });

  fireEvent.change(input!, { target: { files: [tooLarge] } });

  await waitFor(() =>
    expect(view.getByRole("status").textContent).not.toBe("")
  );
  expect(uploadCampaignImage).not.toHaveBeenCalled();
});

test("aligns an image saved without a width at its natural width", async () => {
  const { view, editor, changes, alignmentButtons } = await renderEditor(
    bodyWithImage({})
  );
  const picture = view.container.querySelector(".ProseMirror img");
  Object.defineProperty(picture, "naturalWidth", { value: 800 });

  act(() => {
    editor.commands.setNodeSelection(8);
  });
  await waitFor(() => expect(alignmentButtons()).toHaveLength(3));
  expect(
    alignmentButtons().map((button) => button.getAttribute("aria-pressed"))
  ).toEqual(["false", "true", "false"]);
  fireEvent.click(alignmentButtons()[0]!);

  expect(changes.at(-1)?.content?.[1]?.attrs).toMatchObject({
    align: "left",
    width: 800,
  });
});

test("aligns an image that hasn't loaded without guessing its width", async () => {
  const { editor, changes, alignmentButtons } = await renderEditor(
    bodyWithImage({})
  );

  act(() => {
    editor.commands.setNodeSelection(8);
  });
  await waitFor(() => expect(alignmentButtons()).toHaveLength(3));
  fireEvent.click(alignmentButtons()[2]!);

  expect(changes.at(-1)?.content?.[1]?.attrs).toMatchObject({
    align: "right",
    width: null,
  });
});

test("shows an image without an alignment as centered", async () => {
  const { editor, alignmentButtons } = await renderEditor(
    bodyWithImage({ align: null, width: 480 })
  );

  act(() => {
    editor.commands.setNodeSelection(8);
  });
  await waitFor(() => expect(alignmentButtons()).toHaveLength(3));
  expect(
    alignmentButtons().map((button) => button.getAttribute("aria-pressed"))
  ).toEqual(["false", "true", "false"]);
});
