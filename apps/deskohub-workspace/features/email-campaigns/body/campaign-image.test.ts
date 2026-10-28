import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import type {
  CampaignBodyDocument,
  CampaignBodyNode,
} from "./campaign-body-document";
import { campaignBodySchema } from "./campaign-body-extensions";
import { campaignBodyIssues } from "./campaign-body-rules";
import { writeCampaignContent } from "./campaign-content-codec";
import { markdownCampaignBody as readMarkdown } from "./campaign-content-codec.test-utils";

const cloudinaryImage =
  "https://res.cloudinary.com/cloud/image/upload/v1/campaigns/autumn.jpg";

const writeMarkdown = (body: CampaignBodyDocument) =>
  writeCampaignContent(
    { "cs-CZ": { subject: "", preheader: "", body } },
    "markdown"
  )["cs-CZ"]?.bodyMarkdown ?? "";

const imageAttrs = async (markdown: string) =>
  (await readMarkdown(markdown)).doc.content?.[0]?.attrs;

const imageIssuePaths = (attrs: CampaignBodyNode["attrs"]) =>
  campaignBodyIssues(
    {
      type: "doc",
      content: [{ type: "image", attrs: { src: cloudinaryImage, ...attrs } }],
    } as CampaignBodyNode,
    Option.some("cloud")
  ).map((issue) => [issue._tag, issue.path.at(-1)]);

describe("campaign image", () => {
  test("centers a new image", () => {
    const image = campaignBodySchema.nodes.image?.create({
      src: cloudinaryImage,
    });

    expect(image?.attrs.align).toBe("center");
    expect(image?.attrs.width).toBeNull();
  });

  test("reads a plain Markdown image as one centered without a width", async () => {
    const read = await readMarkdown(`![Zasedačka](${cloudinaryImage})`);
    const image = campaignBodySchema.nodeFromJSON(read.doc).firstChild;

    expect(read.doc.content?.[0]?.attrs).toEqual({
      src: cloudinaryImage,
      alt: "Zasedačka",
      title: null,
    });
    expect(image?.attrs).toMatchObject({ align: "center", width: null });
  });

  test.each([
    `![Zasedačka](${cloudinaryImage})`,
    `![Zasedačka](${cloudinaryImage}){width=240}`,
    `![Zasedačka](${cloudinaryImage}){align=left width=240}`,
    `![Zasedačka](${cloudinaryImage}){align=right width=1200}`,
    `![Zasedačka](${cloudinaryImage} "Podzim"){align=left}`,
  ])("round-trips %s", async (markdown) => {
    const read = await readMarkdown(markdown);

    expect(read.doc.content?.map((node) => node.type)).toEqual(["image"]);
    expect(writeMarkdown(read)).toBe(markdown);
  });

  test("reads an attribute list in any order", async () => {
    expect(
      await imageAttrs(
        `![Zasedačka](${cloudinaryImage}){width=240 align=right}`
      )
    ).toMatchObject({ align: "right", width: 240 });
  });

  test("keeps an image between paragraphs its own block", async () => {
    const read = await readMarkdown(
      `Nad obrázkem\n\n![Zasedačka](${cloudinaryImage}){align=left width=240}\n\nPod obrázkem`
    );

    expect(read.doc.content?.map((node) => node.type)).toEqual([
      "paragraph",
      "image",
      "paragraph",
    ]);
    expect(read.doc.content?.[1]?.attrs).toMatchObject({
      align: "left",
      width: 240,
    });
  });

  test.each([
    ["an unknown key", "{height=240}"],
    ["a repeated key", "{align=left align=right}"],
  ])(
    "doesn't read an attribute list with %s as a layout",
    async (_name, list) => {
      // The list stays text after the image, which a block image can't have.
      await expect(
        readMarkdown(`![Zasedačka](${cloudinaryImage})${list}`)
      ).rejects.toThrow();
    }
  );

  test.each([
    ["alignment", { align: "justify" }, "align"],
    ["width in fractions", { width: 240.5 }, "width"],
    ["width of zero", { width: 0 }, "width"],
    ["width as text", { width: "240" }, "width"],
    // Markdown would spell it `1e+21`, which doesn't read back as a width.
    ["width too large to write as digits", { width: 1e21 }, "width"],
    ["width wider than any picture", { width: 65_536 }, "width"],
  ])("refuses an image with an invalid %s", (_name, attrs, key) => {
    expect(imageIssuePaths(attrs)).toEqual([["ImageLayoutInvalid", key]]);
  });

  test.each([{}, { align: null, width: null }, { align: "left", width: 240 }])(
    "accepts an image laid out as %p",
    (attrs) => {
      expect(imageIssuePaths(attrs)).toEqual([]);
    }
  );

  test("round-trips the widest accepted width", async () => {
    const markdown = `![Zasedačka](${cloudinaryImage}){width=65535}`;
    const read = await readMarkdown(markdown);

    expect(imageIssuePaths(read.doc.content?.[0]?.attrs)).toEqual([]);
    expect(writeMarkdown(read)).toBe(markdown);
  });

  test.each([
    ["a null alignment", null],
    ["no alignment", undefined],
  ])("marks an image with %s as centered in the editor", (_name, align) => {
    const imageType = campaignBodySchema.nodes.image;
    if (!imageType) throw new Error("The schema has no image node.");
    const image = imageType.create({
      src: cloudinaryImage,
      ...(align !== undefined && { align }),
    });

    expect(imageType.spec.toDOM?.(image)).toEqual([
      "img",
      expect.objectContaining({ "data-align": "center" }),
    ]);
  });
});
