import {
  afterAll,
  afterEach,
  beforeEach,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { Effect, Option } from "effect";
import { m } from "@/features/administration/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { CampaignBodyNode } from "../../body/campaign-body-document";

registerWorkspaceComponentTestEnv();

const authorization = {
  url: "https://api.cloudinary.test/v1_1/cloud/image/upload",
  fields: { public_id: "4f1c0b9e", signature: "fake-upload-signature" },
  publicId: "email-campaigns/preview/4f1c0b9e",
};
const storedImage = {
  public_id: authorization.publicId,
  secure_url:
    "https://res.cloudinary.com/cloud/image/upload/v1/email-campaigns/preview/4f1c0b9e.png",
  width: 1068,
};

/** Authorizes the upload as the test needs; by default it's granted. */
let authorize = async (): Promise<{
  readonly data?: typeof authorization;
  readonly serverError?: string;
}> => ({ data: authorization });

mock.module("@/features/email-campaigns/admin/editor/actions", () => ({
  authorizeCampaignImageUpload: () => authorize(),
}));

/** The picture's size as the browser reads it; by default a small one. */
let pictureSize = Option.some({ width: 800, height: 600 });

mock.module("@/shared/browser/image-size", () => ({
  readImageSize: () => Effect.sync(() => pictureSize),
}));

/** Shrinks a picture as the test needs; by default at once. */
const shrunkImage = new Blob([new Uint8Array(2)], { type: "image/jpeg" });
let downscale = (): Effect.Effect<Blob> => Effect.succeed(shrunkImage);

mock.module("@/shared/browser/image-downscaling", () => ({
  downscaleImage: () => downscale(),
}));

/** Cloudinary's answer; by default the stored image. */
const fetchSpy = spyOn(globalThis, "fetch");
const answerStored = () =>
  fetchSpy.mockImplementation(async () => Response.json(storedImage));

const { CampaignBodyEditor } = await import("./campaign-body-editor");
const defaults = { authorize, pictureSize, downscale };

beforeEach(answerStored);
afterEach(() => {
  cleanup();
  fetchSpy.mockReset();
  ({ authorize, pictureSize, downscale } = defaults);
});
afterAll(() => {
  fetchSpy.mockRestore();
  unregisterWorkspaceComponentTestEnv();
});

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

const chooseImage = (view: ReturnType<typeof render>, file: File) => {
  const input =
    view.container.querySelector<HTMLInputElement>('input[type="file"]');
  fireEvent.change(input!, { target: { files: [file] } });
};

const insertButton = (view: ReturnType<typeof render>) =>
  view.queryByRole("button", {
    name: m.emailCampaignsImageUploadInsert({}, { locale }),
  });

const postedFile = (call = 0) => {
  const form = fetchSpy.mock.calls[call]?.[1]?.body;
  return form instanceof FormData ? form.get("file") : null;
};

const png = (name = "new.png") =>
  new File([new Uint8Array(3)], name, { type: "image/png" });

test("uploads an image straight to Cloudinary and inserts it centered at its stored width", async () => {
  const { view, changes } = await renderEditor();

  chooseImage(view, png());

  await waitFor(() =>
    expect(changes.at(-1)?.content).toContainEqual(
      expect.objectContaining({
        type: "image",
        attrs: expect.objectContaining({
          src: storedImage.secure_url,
          align: "center",
          width: 1068,
        }),
      })
    )
  );
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(fetchSpy.mock.calls[0]?.[0]).toBe(authorization.url);
  const posted = postedFile();
  expect(posted instanceof Blob && posted.size).toBe(3);
});

test("shows the editor busy until Cloudinary has stored the image", async () => {
  const { promise: stored, resolve: store } = Promise.withResolvers<void>();
  fetchSpy.mockImplementation(async () => {
    await stored;
    return Response.json(storedImage);
  });
  const { view, changes } = await renderEditor();

  chooseImage(view, png());

  const busy = await waitFor(() => {
    const button = view.getByRole("button", {
      name: m.emailCampaignsImageUploading({}, { locale }),
    });
    expect(button).toHaveProperty("disabled", true);
    return button;
  });
  expect(view.getByRole("status").textContent).not.toBe("");

  store();

  await waitFor(() =>
    expect(busy.isConnected && insertButton(view)).toBeTruthy()
  );
  expect(changes.at(-1)?.content).toContainEqual(
    expect.objectContaining({ type: "image" })
  );
});

test("shrinks an image above the account's limits first, showing the editor busy", async () => {
  pictureSize = Option.some({ width: 6000, height: 5000 });
  const { promise: shrunk, resolve: finishShrinking } =
    Promise.withResolvers<void>();
  downscale = () => Effect.promise(() => shrunk).pipe(Effect.as(shrunkImage));
  const { view } = await renderEditor();

  chooseImage(view, png("big.png"));

  await waitFor(() =>
    expect(
      view.getByRole("button", {
        name: m.emailCampaignsImageShrinking({}, { locale }),
      })
    ).toHaveProperty("disabled", true)
  );
  expect(fetchSpy).not.toHaveBeenCalled();

  finishShrinking();

  await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
  const posted = postedFile();
  expect(posted instanceof Blob && posted.size).toBe(shrunkImage.size);
  await waitFor(() => expect(insertButton(view)).toBeTruthy());
});

test("shows the editor busy while it waits for the upload's authorization", async () => {
  const { promise: authorized, resolve: grant } = Promise.withResolvers<void>();
  authorize = async () => {
    await authorized;
    return { data: authorization };
  };
  const { view } = await renderEditor();

  chooseImage(view, png());

  await waitFor(() =>
    expect(
      view.getByRole("button", {
        name: m.emailCampaignsImageUploading({}, { locale }),
      })
    ).toHaveProperty("disabled", true)
  );
  expect(fetchSpy).not.toHaveBeenCalled();

  grant();

  await waitFor(() => expect(insertButton(view)).toBeTruthy());
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test("uploads nothing once the editor closes while the upload is authorized", async () => {
  const { promise: authorized, resolve: grant } = Promise.withResolvers<void>();
  authorize = async () => {
    await authorized;
    return { data: authorization };
  };
  const { view } = await renderEditor();

  chooseImage(view, png());
  view.unmount();
  grant();
  await authorized;
  await new Promise((settled) => setTimeout(settled, 0));

  expect(fetchSpy).not.toHaveBeenCalled();
});

test("cancels the upload when the editor closes while it's sent", async () => {
  fetchSpy.mockImplementation(
    (_url, init) =>
      new Promise((_, reject) =>
        init?.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason)
        )
      )
  );
  const { view } = await renderEditor();

  chooseImage(view, png());
  await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
  view.unmount();

  await waitFor(() =>
    expect(fetchSpy.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
  );
});

test("says the image can't be read when Cloudinary refuses it, and inserts nothing", async () => {
  fetchSpy.mockImplementation(async () =>
    Response.json({ error: { message: "Invalid image file" } }, { status: 400 })
  );
  const { view, changes } = await renderEditor();
  const before = changes.length;

  chooseImage(view, png("broken.png"));

  await waitFor(() =>
    expect(view.getByRole("status").textContent).toBe(
      m.emailCampaignsImageUploadUnreadable({}, { locale })
    )
  );
  expect(changes.slice(before)).toEqual([]);
  expect(insertButton(view)).toHaveProperty("disabled", false);
});

test("uploads nothing when the upload isn't authorized", async () => {
  const reason = "synthetic reason";
  authorize = async () => ({ serverError: reason });
  const { view } = await renderEditor();

  chooseImage(view, png());

  await waitFor(() =>
    expect(view.getByRole("status").textContent).toBe(reason)
  );
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(insertButton(view)).toHaveProperty("disabled", false);
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
