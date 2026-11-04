import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { EmailDraft } from "@deskohub/workspace-admin-api";
import { Effect, Option } from "effect";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();
// React DOM and Radix detect the DOM when they load, so load them after it.
const { act, cleanup, fireEvent, render, waitFor, within } = await import(
  "@testing-library/react"
);
const { FormProvider, useForm } = await import("react-hook-form");

const authorization = {
  url: "https://api.cloudinary.test/v1_1/cloud/image/upload",
  fields: { public_id: "4f1c0b9e", signature: "fake-upload-signature" },
  publicId: "emails/preview/4f1c0b9e",
};
const storedImage = {
  public_id: authorization.publicId,
  secure_url:
    "https://res.cloudinary.com/cloud/image/upload/v1/emails/preview/4f1c0b9e.png",
  width: 1068,
};

mock.module("@/features/emails/admin/editor/image-upload-actions", () => ({
  authorizeEmailImageUpload: async () => ({ data: authorization }),
}));
mock.module("@/shared/browser/image-size", () => ({
  readImageSize: () =>
    Effect.sync(() => Option.some({ width: 800, height: 600 })),
}));

const fetchSpy = spyOn(globalThis, "fetch");
const answer = (body: typeof storedImage) =>
  fetchSpy.mockImplementation(async () => Response.json(body));

const { RouteLocaleProvider } = await import("@/features/i18n/route-locale");
const { EmailEditorProvider } = await import("./email-editor-context");
const { emailEditorFieldIds } = await import("./email-editor-field-ids");
const { EmailStructureSection } = await import("./email-structure-section");
const { emailBlockChoices } = await import("./email-structure-blocks");

beforeEach(() => answer(storedImage));
afterEach(() => {
  cleanup();
  fetchSpy.mockReset();
});
afterAll(() => {
  fetchSpy.mockRestore();
  unregisterWorkspaceComponentTestEnv();
});

const locale = "en-US" satisfies Locale;
type Draft = typeof EmailDraft.Encoded;
type Component = NonNullable<Draft["structure"]>[number];

const text = (value: string) => [{ _tag: "Text" as const, text: value }];

/** Renders the section in a host draft form; `values()` reads the form. */
const renderSection = (defaultValues: Draft = {}) => {
  let read: () => Draft = () => defaultValues;
  function Host() {
    const form = useForm<Draft, unknown, EmailDraft>({
      resolver: effectSchemaResolver(EmailDraft),
      defaultValues,
    });
    read = () => form.getValues();
    return (
      <RouteLocaleProvider locale={locale}>
        <FormProvider {...form}>
          <EmailEditorProvider
            imageCloudName="cloud"
            locales={["en-US", "cs-CZ"]}
          >
            <EmailStructureSection contentLocale="en-US" />
          </EmailEditorProvider>
        </FormProvider>
      </RouteLocaleProvider>
    );
  }
  const view = render(<Host />);
  return { view, values: () => read() };
};

type View = ReturnType<typeof render>;

/** Opens a Radix menu or select from the keyboard. */
const open = async (trigger: HTMLElement) => {
  await act(async () => {
    fireEvent.keyDown(trigger, { key: "Enter" });
  });
};

const choose = async (view: View, trigger: HTMLElement, name: string) => {
  await open(trigger);
  await act(async () => {
    fireEvent.click(view.getByRole("option", { name }));
  });
};

const click = async (element: HTMLElement) => {
  await act(async () => {
    fireEvent.click(element);
  });
};

const type = async (element: HTMLElement, value: string) => {
  await act(async () => {
    fireEvent.change(element, { target: { value } });
  });
};

const addBlock = async (view: View, kind: string) => {
  await open(
    view.getByRole("button", {
      name: m.emailsEditorStructureAddBlock({}, { locale }),
    })
  );
  await click(view.getByRole("menuitem", { name: kind }));
};

const block = (view: View, kind: string, number: number) =>
  within(
    view.getByRole("group", {
      name: m.emailsEditorBlockTitle({ kind, number }, { locale }),
    })
  );

const kinds = {
  Paragraph: m.emailsEditorBlockParagraph({}, { locale }),
  Heading: m.emailsEditorBlockHeading({}, { locale }),
  BulletedList: m.emailsEditorBlockBulletedList({}, { locale }),
  NumberedList: m.emailsEditorBlockNumberedList({}, { locale }),
  Divider: m.emailsEditorBlockDivider({}, { locale }),
  Spacer: m.emailsEditorBlockSpacer({}, { locale }),
  Image: m.emailsEditorBlockImage({}, { locale }),
  Button: m.emailsEditorBlockButton({}, { locale }),
  Record: m.emailsEditorBlockRecord({}, { locale }),
  List: m.emailsEditorBlockList({}, { locale }),
  Offer: m.emailsEditorBlockOffer({}, { locale }),
};

const key = expect.stringMatching(/.+/);

describe("adding blocks", () => {
  test("each kind joins the body with a fresh id and fresh text keys", async () => {
    const { view, values } = renderSection();
    const expected = {
      Paragraph: { _tag: "Paragraph", id: key, textKey: key },
      Heading: { _tag: "Heading", id: key, textKey: key, level: 2 },
      BulletedList: {
        _tag: "TextList",
        id: key,
        ordered: false,
        items: [{ textKey: key }],
      },
      NumberedList: {
        _tag: "TextList",
        id: key,
        ordered: true,
        items: [{ textKey: key }],
      },
      Divider: { _tag: "Divider", id: key },
      Spacer: { _tag: "Spacer", id: key },
      Image: { _tag: "Image", id: key, altKey: key },
      Button: { _tag: "Button", id: key, labelKey: key },
      Record: { _tag: "Record", id: key },
      List: { _tag: "List", id: key },
      Offer: { _tag: "Offer", id: key, labelKey: key },
    } satisfies Record<keyof typeof kinds, Component>;

    for (const choice of emailBlockChoices) {
      const kind = kinds[choice];
      await addBlock(view, kind);
      const structure = values().structure ?? [];
      expect(structure.at(-1)).toEqual(expected[choice]);
      // The new block is in the body, numbered, and has the focus.
      const group = view.getByRole("group", {
        name: m.emailsEditorBlockTitle(
          { kind, number: structure.length },
          { locale }
        ),
      });
      await waitFor(() => expect(document.activeElement?.id).toBe(group.id));
    }

    const structure = values().structure ?? [];
    const ids = structure.map((component) => component.id);
    expect(new Set(ids).size).toBe(ids.length);
    const textKeys = structure.flatMap((component) => [
      ...(component.textKey ? [component.textKey] : []),
      ...(component.labelKey ? [component.labelKey] : []),
      ...(component.altKey ? [component.altKey] : []),
      ...(component.items ?? []).flatMap((item) => item.textKey ?? []),
    ]);
    expect(new Set(textKeys).size).toBe(textKeys.length);
  });

  test("an empty body marks the add-block control with its problem", () => {
    const { view } = renderSection();
    const add = view.getByRole("button", {
      name: m.emailsEditorStructureAddBlock({}, { locale }),
    });
    expect(add.id).toBe(emailEditorFieldIds.addBlock);
    expect(add.getAttribute("aria-invalid")).toBe("true");
    expect(
      document.getElementById(add.getAttribute("aria-describedby") ?? "")
        ?.textContent
    ).toBe(m.emailsEditorProblemBodyEmpty({}, { locale }));
  });
});

describe("moving and removing blocks", () => {
  const paragraph = (id: string): Component => ({
    _tag: "Paragraph",
    id,
    textKey: `${id}-text`,
  });
  const draft: Draft = {
    structure: [paragraph("first"), paragraph("second"), paragraph("third")],
    translations: {
      "en-US": {
        subject: text("Hello"),
        texts: {
          "first-text": text("One"),
          "second-text": text("Two"),
          "third-text": text("Three"),
        },
      },
      "cs-CZ": {
        texts: { "first-text": text("Jedna"), "second-text": text("Dva") },
      },
      // A language the editor doesn't show keeps no orphaned texts either.
      "de-DE": { texts: { "second-text": text("Zwei") } },
    },
  };
  const kind = kinds.Paragraph;

  test("moving a block keeps its texts and its focus", async () => {
    const { view, values } = renderSection(draft);
    const moveDown = block(view, kind, 1).getByRole("button", {
      name: m.emailsEditorBlockMoveDown({ number: 1, kind }, { locale }),
    });
    expect(
      block(view, kind, 1)
        .getByRole("button", {
          name: m.emailsEditorBlockMoveUp({ number: 1, kind }, { locale }),
        })
        .hasAttribute("disabled")
    ).toBe(true);

    await click(moveDown);

    expect(values().structure?.map((component) => component.id)).toEqual([
      "second",
      "first",
      "third",
    ]);
    expect(values().translations).toEqual(draft.translations);
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("aria-label")).toBe(
        m.emailsEditorBlockMoveDown({ number: 2, kind }, { locale })
      )
    );

    await click(
      block(view, kind, 2).getByRole("button", {
        name: m.emailsEditorBlockMoveUp({ number: 2, kind }, { locale }),
      })
    );
    expect(values().structure?.map((component) => component.id)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  test("removing a block deletes its texts in every language", async () => {
    const { view, values } = renderSection(draft);

    await click(
      block(view, kind, 2).getByRole("button", {
        name: m.emailsEditorBlockRemove({ number: 2, kind }, { locale }),
      })
    );

    expect(values().structure?.map((component) => component.id)).toEqual([
      "first",
      "third",
    ]);
    expect(values().translations).toEqual({
      "en-US": {
        subject: text("Hello"),
        texts: { "first-text": text("One"), "third-text": text("Three") },
      },
      "cs-CZ": { texts: { "first-text": text("Jedna") } },
      "de-DE": { texts: {} },
    });
  });
});

test("removing a block keeps a text another block still uses", async () => {
  const { view, values } = renderSection({
    structure: [
      { _tag: "Paragraph", id: "first", textKey: "shared" },
      { _tag: "Paragraph", id: "second", textKey: "shared" },
    ],
    translations: {
      "en-US": { texts: { shared: text("Both") } },
      "de-DE": { texts: { shared: text("Beide") } },
    },
  });
  const kind = kinds.Paragraph;

  await click(
    block(view, kind, 1).getByRole("button", {
      name: m.emailsEditorBlockRemove({ number: 1, kind }, { locale }),
    })
  );

  expect(values().structure?.map((component) => component.id)).toEqual([
    "second",
  ]);
  expect(values().translations).toEqual({
    "en-US": { texts: { shared: text("Both") } },
    "de-DE": { texts: { shared: text("Beide") } },
  });
});

describe("text blocks", () => {
  test("a heading's level is a shared setting", async () => {
    const { view, values } = renderSection({
      structure: [{ _tag: "Heading", id: "title", textKey: "title-text" }],
    });
    const level = view.getByRole("combobox", {
      name: m.emailsEditorBlockLevel({}, { locale }),
    });
    expect(level.id).toBe(
      emailEditorFieldIds.componentSetting("title", "level")
    );
    expect(level.getAttribute("aria-invalid")).toBe("true");

    await choose(
      view,
      level,
      m.emailsEditorBlockLevelOption({ level: 3 }, { locale })
    );

    expect(values().structure?.[0]?.level).toBe(3);
    expect(
      view
        .getByRole("combobox", {
          name: m.emailsEditorBlockLevel({}, { locale }),
        })
        .hasAttribute("aria-invalid")
    ).toBe(false);
  });

  test("link destinations are added, edited and removed for every language", async () => {
    const { view, values } = renderSection({
      structure: [
        {
          _tag: "Paragraph",
          id: "intro",
          textKey: "intro-text",
          links: { offer: "https://deskohub.test/offer" },
        },
      ],
      translations: {
        "en-US": {
          texts: {
            "intro-text": [
              { _tag: "Text", text: "See the offer", link: "offer" },
            ],
          },
        },
      },
    });
    const textId = emailEditorFieldIds.text("en-US", "intro-text");
    expect(document.getElementById(textId)?.hasAttribute("aria-invalid")).toBe(
      false
    );

    await click(
      view.getByRole("button", {
        name: m.emailsEditorBlockLinkAdd({}, { locale }),
      })
    );
    const links = values().structure?.[0]?.links ?? {};
    const [added] = Object.keys(links).filter((linkKey) => linkKey !== "offer");
    expect(added).toMatch(/^link-/);
    const destination = view.getByRole("textbox", {
      name: m.emailsEditorBlockLinkLabel({ number: 2 }, { locale }),
    });
    expect(destination.id).toBe(
      emailEditorFieldIds.componentLink("intro", added ?? "")
    );
    await type(destination, "ftp://deskohub.test");
    expect(values().structure?.[0]?.links?.[added ?? ""]).toBe(
      "ftp://deskohub.test"
    );
    expect(destination.getAttribute("aria-invalid")).toBe("true");

    await click(
      view.getByRole("button", {
        name: m.emailsEditorBlockLinkRemove({ number: 1 }, { locale }),
      })
    );

    expect(Object.keys(values().structure?.[0]?.links ?? {})).toEqual([
      added ?? "",
    ]);
    // Focus stays in the destinations, on the row that took the removed one's place.
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("aria-label")).toBe(
        m.emailsEditorBlockLinkRemove({ number: 1 }, { locale })
      )
    );
    // The text still links to the removed destination, which it now shows.
    expect(document.getElementById(textId)?.getAttribute("aria-invalid")).toBe(
      "true"
    );
  });
});

describe("text lists", () => {
  const list = (ordered: boolean): Draft => ({
    structure: [
      {
        _tag: "TextList",
        id: "steps",
        ordered,
        items: [{ textKey: "a" }, { textKey: "b" }, { textKey: "c" }],
      },
    ],
    translations: {
      "en-US": { texts: { a: text("A"), b: text("B"), c: text("C") } },
      "cs-CZ": { texts: { a: text("A"), b: text("B"), c: text("C") } },
    },
  });
  const itemButton = (view: View, label: string) =>
    view.getByRole("button", { name: label });
  const items = (values: () => Draft) => values().structure?.[0]?.items;

  test("items nest under the item before them and move back out", async () => {
    const { view, values } = renderSection(list(true));
    expect(
      itemButton(
        view,
        m.emailsEditorBlockListItemIndent({ number: "1" }, { locale })
      ).hasAttribute("disabled")
    ).toBe(true);

    await click(
      itemButton(
        view,
        m.emailsEditorBlockListItemIndent({ number: "2" }, { locale })
      )
    );
    // The new level numbers its items, as the list it was made in does.
    expect(items(values)).toEqual([
      { textKey: "a", list: { ordered: true, items: [{ textKey: "b" }] } },
      { textKey: "c" },
    ]);

    await click(
      itemButton(
        view,
        m.emailsEditorBlockListItemIndent({ number: "2" }, { locale })
      )
    );
    expect(items(values)).toEqual([
      {
        textKey: "a",
        list: { ordered: true, items: [{ textKey: "b" }, { textKey: "c" }] },
      },
    ]);

    const nestedOrdered = view.getByRole("switch", {
      name: m.emailsEditorBlockListNestedOrdered({ number: "1" }, { locale }),
    });
    // The nested level's switch is a block setting control like the others.
    expect(
      nestedOrdered.id.startsWith(
        emailEditorFieldIds.componentSetting("steps", "items")
      )
    ).toBe(true);
    expect(nestedOrdered.hasAttribute("aria-invalid")).toBe(false);
    await click(nestedOrdered);
    expect(items(values)?.[0]?.list?.ordered).toBe(false);

    await click(
      itemButton(
        view,
        m.emailsEditorBlockListItemOutdent({ number: "1.1" }, { locale })
      )
    );
    expect(items(values)).toEqual([
      { textKey: "a", list: { ordered: false, items: [{ textKey: "c" }] } },
      { textKey: "b" },
    ]);

    await click(
      itemButton(
        view,
        m.emailsEditorBlockListItemOutdent({ number: "1.1" }, { locale })
      )
    );
    // The emptied level is gone.
    expect(items(values)).toEqual([
      { textKey: "a" },
      { textKey: "c" },
      { textKey: "b" },
    ]);
    expect(values().translations).toEqual(list(true).translations);
  });

  test("items that share a text key keep their own controls", async () => {
    const { view, values } = renderSection({
      structure: [
        {
          _tag: "TextList",
          id: "steps",
          ordered: false,
          items: [
            {
              textKey: "a",
              list: { ordered: false, items: [{ textKey: "x" }] },
            },
            {
              textKey: "a",
              list: { ordered: false, items: [{ textKey: "y" }] },
            },
          ],
        },
      ],
    });
    const switches = view.getAllByRole("switch");
    expect(new Set(switches.map((control) => control.id)).size).toBe(
      switches.length
    );

    await click(
      view.getByText(
        m.emailsEditorBlockListNestedOrdered({ number: "2" }, { locale })
      )
    );

    expect(items(values)?.map((item) => item.list?.ordered)).toEqual([
      false,
      true,
    ]);
  });

  test("focus follows a moved item whose text key repeats or is missing", async () => {
    const { view, values } = renderSection({
      structure: [
        {
          _tag: "TextList",
          id: "steps",
          ordered: false,
          items: [{ textKey: "a" }, { textKey: "a" }, {}],
        },
      ],
    });
    const moveDown = (number: string) =>
      m.emailsEditorBlockListItemMoveDown({ number }, { locale });

    await click(
      itemButton(
        view,
        m.emailsEditorBlockListItemMoveUp({ number: "2" }, { locale })
      )
    );
    // Its Move up is now disabled, so focus is on its Move down, at 1.
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("aria-label")).toBe(
        moveDown("1")
      )
    );

    await click(
      itemButton(
        view,
        m.emailsEditorBlockListItemMoveUp({ number: "3" }, { locale })
      )
    );
    expect(items(values)).toEqual([{ textKey: "a" }, {}, { textKey: "a" }]);
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("aria-label")).toBe(
        m.emailsEditorBlockListItemMoveUp({ number: "2" }, { locale })
      )
    );
  });

  test("items are added, moved and removed with their texts", async () => {
    const { view, values } = renderSection(list(false));

    await click(
      itemButton(
        view,
        m.emailsEditorBlockListItemMoveDown({ number: "1" }, { locale })
      )
    );
    expect(items(values)?.map((item) => item.textKey)).toEqual(["b", "a", "c"]);

    await click(
      itemButton(
        view,
        m.emailsEditorBlockListItemIndent({ number: "3" }, { locale })
      )
    );
    expect(items(values)?.[1]).toEqual({
      textKey: "a",
      list: { ordered: false, items: [{ textKey: "c" }] },
    });
    await click(
      view.getByRole("button", {
        name: m.emailsEditorBlockListNestedItemAdd({ number: "2" }, { locale }),
      })
    );
    const nested = items(values)?.[1]?.list?.items ?? [];
    expect(nested).toHaveLength(2);
    expect(nested[1]?.textKey).toMatch(/^text-/);

    // Removing an item removes what's nested under it, in every language.
    await click(
      itemButton(
        view,
        m.emailsEditorBlockListItemRemove({ number: "2" }, { locale })
      )
    );
    expect(items(values)).toEqual([{ textKey: "b" }]);
    expect(values().translations).toEqual({
      "en-US": { texts: { b: text("B") } },
      "cs-CZ": { texts: { b: text("B") } },
    });

    await click(
      view.getByRole("button", {
        name: m.emailsEditorBlockListItemAdd({}, { locale }),
      })
    );
    expect(items(values)).toEqual([{ textKey: "b" }, { textKey: key }]);
  });

  test("numbering and the first number are shared settings", async () => {
    const { view, values } = renderSection(list(false));
    const ordered = view.getByRole("switch", {
      name: m.emailsEditorBlockListOrdered({}, { locale }),
    });
    expect(ordered.id).toBe(
      emailEditorFieldIds.componentSetting("steps", "ordered")
    );

    await click(ordered);
    const start = view.getByRole("spinbutton", {
      name: m.emailsEditorBlockListStart({}, { locale }),
    });
    await type(start, "4");
    expect(values().structure?.[0]).toMatchObject({ ordered: true, start: 4 });

    await type(start, "");
    expect(values().structure?.[0]).not.toHaveProperty("start");

    await type(start, "0");
    expect(values().structure?.[0]?.start).toBe(0);
    await click(ordered);
    expect(values().structure?.[0]).toEqual(
      expect.not.objectContaining({ start: expect.anything() })
    );
    expect(values().structure?.[0]?.ordered).toBe(false);
  });
});

describe("images", () => {
  const imageDraft: Draft = {
    structure: [{ _tag: "Image", id: "hero", altKey: "hero-alt" }],
  };
  const chooseImage = async (view: View) => {
    const input =
      view.container.querySelector<HTMLInputElement>('input[type="file"]');
    await act(async () => {
      fireEvent.change(input as HTMLInputElement, {
        target: {
          files: [
            new File([new Uint8Array(3)], "hero.png", { type: "image/png" }),
          ],
        },
      });
    });
  };
  const uploadButton = (view: View) =>
    view.getByRole("button", {
      name: m.emailsEditorBlockImageUpload({}, { locale }),
    });

  test("an image Cloudinary stored as authorized becomes the block's source", async () => {
    const { view, values } = renderSection(imageDraft);
    expect(uploadButton(view).id).toBe(
      emailEditorFieldIds.componentSetting("hero", "src")
    );
    expect(uploadButton(view).getAttribute("aria-invalid")).toBe("true");
    // The regions are mounted before anything is announced.
    expect(view.getByRole("status").textContent).toBe("");
    expect(view.getByRole("alert").textContent).toBe("");

    await chooseImage(view);

    await waitFor(() =>
      expect(values().structure?.[0]?.src).toBe(storedImage.secure_url)
    );
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(authorization.url);
    // The block keeps no width until the author sets one.
    expect(values().structure?.[0]).not.toHaveProperty("width");
    expect(
      view.getByRole("button", {
        name: m.emailsEditorBlockImageReplace({}, { locale }),
      })
    ).toBeTruthy();
    expect(view.container.querySelector("img")?.getAttribute("src")).toBe(
      storedImage.secure_url
    );
    expect(view.getByRole("alert").textContent).toBe("");
  });

  test("an image stored under another public id is refused", async () => {
    answer({ ...storedImage, public_id: "emails/preview/someone-else" });
    const { view, values } = renderSection(imageDraft);

    await chooseImage(view);

    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toBe(
        m.emailsEditorImageUploadFailed({}, { locale })
      )
    );
    expect(values().structure?.[0]).not.toHaveProperty("src");
    expect(uploadButton(view).hasAttribute("disabled")).toBe(false);
    expect(view.getByRole("status").textContent).toBe("");
  });

  test("an upload that ends after the block moved and changed sets only its source", async () => {
    const { promise: stored, resolve: store } = Promise.withResolvers<void>();
    fetchSpy.mockImplementation(async () => {
      await stored;
      return Response.json(storedImage);
    });
    const { view, values } = renderSection({
      structure: [
        { _tag: "Image", id: "hero", altKey: "hero-alt" },
        { _tag: "Paragraph", id: "after", textKey: "after-text" },
      ],
    });

    await chooseImage(view);
    await waitFor(() =>
      expect(view.getByRole("status").textContent).toBe(
        m.emailsEditorBlockImageUploading({}, { locale })
      )
    );
    expect(uploadButton(view).hasAttribute("disabled")).toBe(true);
    const kind = kinds.Image;
    await click(
      block(view, kind, 1).getByRole("button", {
        name: m.emailsEditorBlockMoveDown({ number: 1, kind }, { locale }),
      })
    );
    await choose(
      view,
      view.getByRole("combobox", {
        name: m.emailsEditorBlockImageAlign({}, { locale }),
      }),
      m.emailsEditorBlockImageAlignLeft({}, { locale })
    );
    await act(async () => store());

    await waitFor(() =>
      expect(values().structure?.[1]).toEqual({
        _tag: "Image",
        id: "hero",
        altKey: "hero-alt",
        align: "left",
        src: storedImage.secure_url,
      })
    );
    expect(values().structure?.[0]).toEqual({
      _tag: "Paragraph",
      id: "after",
      textKey: "after-text",
    });
    expect(view.getByRole("status").textContent).toBe("");
  });

  test("an upload that ends after its block was removed changes nothing", async () => {
    const { promise: stored, resolve: store } = Promise.withResolvers<void>();
    fetchSpy.mockImplementation(async () => {
      await stored;
      return Response.json(storedImage);
    });
    const { view, values } = renderSection(imageDraft);

    await chooseImage(view);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const kind = kinds.Image;
    await click(
      block(view, kind, 1).getByRole("button", {
        name: m.emailsEditorBlockRemove({ number: 1, kind }, { locale }),
      })
    );
    await act(async () => store());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(values().structure).toEqual([]);
  });

  test("alignment, width and link are shared settings; an empty width is unset", async () => {
    const { view, values } = renderSection(imageDraft);

    await choose(
      view,
      view.getByRole("combobox", {
        name: m.emailsEditorBlockImageAlign({}, { locale }),
      }),
      m.emailsEditorBlockImageAlignRight({}, { locale })
    );
    const width = view.getByRole("spinbutton", {
      name: m.emailsEditorBlockImageWidth({}, { locale }),
    });
    await type(width, "320");
    await type(
      view.getByRole("textbox", {
        name: m.emailsEditorBlockImageHref({}, { locale }),
      }),
      "https://deskohub.test"
    );
    expect(values().structure?.[0]).toMatchObject({
      align: "right",
      width: 320,
      href: "https://deskohub.test",
    });

    await type(width, "0");
    expect(values().structure?.[0]?.width).toBe(320);
    await type(width, "");
    expect(values().structure?.[0]).not.toHaveProperty("width");
  });
});

describe("value blocks", () => {
  const values: NonNullable<Draft["values"]> = [
    {
      name: "stats",
      source: {
        kind: "customer",
        path: ["activity", "stats"],
        fields: [["reservationCount"], ["favoriteProduct"]],
      },
    },
    {
      name: "bookings",
      source: {
        kind: "customer",
        path: ["activity", "reservations"],
        fields: [["date"], ["startsAt"]],
      },
    },
    {
      name: "visits",
      source: {
        kind: "customer",
        path: ["activity", "stats", "reservationCount"],
      },
    },
    {
      name: "promo",
      source: { kind: "discount", discountId: "d-1", validDays: 7 },
    },
  ];
  const valuePicker = (view: View) =>
    view.getByRole("combobox", {
      name: m.emailsEditorBlockValue({}, { locale }),
    });
  const optionNames = (view: View) =>
    view.getAllByRole("option").map((option) => option.textContent);

  test.each([
    ["Record", ["stats"]],
    ["List", ["bookings"]],
    ["Offer", ["promo"]],
  ] as const)(
    "a %s block offers only values of its kind",
    async (tag, names) => {
      const { view } = renderSection({
        structure: [{ _tag: tag, id: "block" }],
        values,
      });
      await open(valuePicker(view));
      expect(optionNames(view)).toEqual([...names]);
    }
  );

  test("a value that no longer exists stays visible as the choice", async () => {
    const { view } = renderSection({
      structure: [{ _tag: "Record", id: "block", value: "gone" }],
      values,
    });
    const picker = valuePicker(view);
    const unavailable = m.emailsEditorBlockValueUnavailable(
      { name: "gone" },
      { locale }
    );
    expect(picker.textContent).toContain(unavailable);
    expect(picker.getAttribute("aria-invalid")).toBe("true");
    await open(picker);
    expect(optionNames(view)).toEqual(["stats", unavailable]);
  });

  test("a record block shows the chosen fields, each with its label", async () => {
    const { view, values: form } = renderSection({
      structure: [{ _tag: "Record", id: "block" }],
      translations: { "cs-CZ": { texts: {} } },
      values,
    });
    await choose(view, valuePicker(view), "stats");
    expect(form().structure?.[0]?.value).toBe("stats");

    await click(
      view.getByRole("button", {
        name: m.emailsEditorBlockFieldAdd({}, { locale }),
      })
    );
    await choose(
      view,
      view.getByRole("combobox", {
        name: m.emailsEditorBlockField({ number: 1 }, { locale }),
      }),
      "favoriteProduct"
    );
    const field = form().structure?.[0]?.fields?.[0];
    expect(field).toEqual({ labelKey: key, field: ["favoriteProduct"] });
    expect(
      view.getByRole("textbox", {
        name: m.emailsEditorBlockFieldLabel({ number: 1 }, { locale }),
      }).id
    ).toBe(emailEditorFieldIds.text("en-US", field?.labelKey ?? ""));

    await click(
      view.getByRole("button", {
        name: m.emailsEditorBlockFieldRemove({ number: 1 }, { locale }),
      })
    );
    expect(form().structure?.[0]).not.toHaveProperty("fields");
    // Without fields, the record has a problem on its fields.
    expect(
      document
        .getElementById(emailEditorFieldIds.componentSetting("block", "fields"))
        ?.getAttribute("aria-invalid")
    ).toBe("true");
  });

  test("fields that share a label key keep their own controls", () => {
    const { view } = renderSection({
      structure: [
        {
          _tag: "Record",
          id: "block",
          value: "stats",
          fields: [
            { labelKey: "label", field: ["reservationCount"] },
            { labelKey: "label", field: ["favoriteProduct"] },
            { labelKey: "label@1", field: ["reservationCount"] },
            { field: ["favoriteProduct"] },
          ],
        },
      ],
      values,
    });
    const pickers = [1, 2, 3, 4].map((number) =>
      view.getByRole("combobox", {
        name: m.emailsEditorBlockField({ number }, { locale }),
      })
    );
    expect(new Set(pickers.map((picker) => picker.id)).size).toBe(4);
    expect(pickers[1]?.textContent).toContain("favoriteProduct");
  });

  test("removing a field deletes its label in every language", async () => {
    const { view, values: form } = renderSection({
      structure: [
        {
          _tag: "Record",
          id: "block",
          value: "stats",
          fields: [
            { labelKey: "visits-label", field: ["reservationCount"] },
            { labelKey: "product-label", field: ["favoriteProduct"] },
          ],
        },
      ],
      translations: {
        "en-US": {
          texts: {
            "visits-label": text("Visits"),
            "product-label": text("Favourite"),
          },
        },
        "cs-CZ": { texts: { "visits-label": text("Návštěvy") } },
        "de-DE": { texts: { "visits-label": text("Besuche") } },
      },
      values,
    });

    await click(
      view.getByRole("button", {
        name: m.emailsEditorBlockFieldRemove({ number: 1 }, { locale }),
      })
    );

    expect(form().structure?.[0]?.fields).toEqual([
      { labelKey: "product-label", field: ["favoriteProduct"] },
    ]);
    expect(form().translations).toEqual({
      "en-US": { texts: { "product-label": text("Favourite") } },
      "cs-CZ": { texts: {} },
      "de-DE": { texts: {} },
    });
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("aria-label")).toBe(
        m.emailsEditorBlockFieldRemove({ number: 1 }, { locale })
      )
    );

    await click(
      view.getByRole("button", {
        name: m.emailsEditorBlockFieldRemove({ number: 1 }, { locale }),
      })
    );
    // With no row left, focus moves to adding one.
    await waitFor(() =>
      expect(document.activeElement?.textContent).toBe(
        m.emailsEditorBlockFieldAdd({}, { locale })
      )
    );
  });

  test("a list block sorts by a chosen field and limits its items", async () => {
    const { view, values: form } = renderSection({
      structure: [{ _tag: "List", id: "block", value: "bookings" }],
      values,
    });
    const sort = view.getByRole("combobox", {
      name: m.emailsEditorBlockSort({}, { locale }),
    });
    expect(sort.id).toBe(emailEditorFieldIds.componentSetting("block", "sort"));
    await open(sort);
    expect(optionNames(view)).toEqual([
      m.emailsEditorBlockSortNone({}, { locale }),
      "date",
      "startsAt",
    ]);
    await act(async () => {
      fireEvent.click(view.getByRole("option", { name: "startsAt" }));
    });
    expect(form().structure?.[0]?.sort).toEqual({
      path: ["startsAt"],
      direction: "asc",
    });
    await choose(
      view,
      view.getByRole("combobox", {
        name: m.emailsEditorBlockSortDirection({}, { locale }),
      }),
      m.emailsEditorBlockSortDescending({}, { locale })
    );
    expect(form().structure?.[0]?.sort).toEqual({
      path: ["startsAt"],
      direction: "desc",
    });

    const limit = view.getByRole("spinbutton", {
      name: m.emailsEditorBlockLimit({}, { locale }),
    });
    await type(limit, "5");
    expect(form().structure?.[0]?.limit).toBe(5);
    await type(limit, "");
    expect(form().structure?.[0]).not.toHaveProperty("limit");

    await choose(
      view,
      view.getByRole("combobox", {
        name: m.emailsEditorBlockSort({}, { locale }),
      }),
      m.emailsEditorBlockSortNone({}, { locale })
    );
    expect(form().structure?.[0]).not.toHaveProperty("sort");
  });

  test("an offer leads to its destination", async () => {
    const { view, values: form } = renderSection({
      structure: [
        { _tag: "Offer", id: "block", value: "promo", labelKey: "cta" },
      ],
      values,
    });
    const href = view.getByRole("textbox", {
      name: m.emailsEditorBlockHref({}, { locale }),
    });
    expect(href.id).toBe(emailEditorFieldIds.componentSetting("block", "href"));
    expect(href.getAttribute("aria-invalid")).toBe("true");
    await type(href, "https://deskohub.test/book");
    expect(form().structure?.[0]?.href).toBe("https://deskohub.test/book");
    expect(href.hasAttribute("aria-invalid")).toBe(false);
  });
});

test("a button's destination problem is described under its control", async () => {
  const { view } = renderSection({
    structure: [
      { _tag: "Button", id: "cta", labelKey: "cta-label", href: "ftp://x" },
    ],
  });
  const href = view.getByRole("textbox", {
    name: m.emailsEditorBlockHref({}, { locale }),
  });
  expect(href.id).toBe(emailEditorFieldIds.componentSetting("cta", "href"));
  expect(href.getAttribute("aria-invalid")).toBe("true");
  expect(
    document.getElementById(href.getAttribute("aria-describedby") ?? "")
      ?.textContent
  ).toBe(m.emailsEditorProblemDestinationInvalid({}, { locale }));
  expect(
    view.getByRole("textbox", {
      name: m.emailsEditorBlockButtonLabel({}, { locale }),
    }).id
  ).toBe(emailEditorFieldIds.text("en-US", "cta-label"));
});
