import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Option } from "effect";
import type { CampaignBodyNode } from "./campaign-body-document";
import {
  campaignBodyIssues,
  campaignBodyStructureIssues,
  campaignButtonLabelIssue,
  emptyCampaignBody,
  isCampaignBodyEmpty,
  isCampaignLinkHref,
} from "./campaign-body-rules";

const imageCloudName = Option.some("synthetic-cloud");

const doc = (
  ...content: ReadonlyArray<CampaignBodyNode>
): CampaignBodyNode => ({
  type: "doc",
  content: [...content],
});

const text = (value: string, marks?: CampaignBodyNode["marks"]) =>
  marks ? { type: "text", text: value, marks } : { type: "text", text: value };

const paragraph = (...content: ReadonlyArray<CampaignBodyNode>) => ({
  type: "paragraph",
  content: [...content],
});

const link = (href: string | null) =>
  paragraph(text("odkaz", [{ type: "link", attrs: { href, title: null } }]));

const image = (src: string) => ({
  type: "image",
  attrs: { src, alt: "Workspace", title: null },
});

const cta = (attrs: CampaignBodyNode["attrs"]) => ({
  type: "ctaButton",
  attrs,
});

const cloudinaryImage =
  "https://res.cloudinary.com/synthetic-cloud/image/upload/v1/campaigns/autumn.jpg";

const issueTags = (
  body: CampaignBodyNode,
  cloudName: Option.Option<string> = imageCloudName
) => campaignBodyIssues(body, cloudName).map(({ _tag }) => _tag);

describe("campaignBodyIssues", () => {
  test("accepts links, images and buttons that follow the rules", () => {
    expect(
      issueTags(
        doc(
          link("https://workspace.deskohub.cz"),
          link(`mailto:${testEmailAddress("campaign")}`),
          image(cloudinaryImage),
          { type: "horizontalRule" },
          cta({ label: "Rezervovat", href: "https://workspace.deskohub.cz" })
        )
      )
    ).toEqual([]);
  });

  test("rejects a root that isn't a doc node", () => {
    expect(campaignBodyIssues(paragraph(text("x")), imageCloudName)).toEqual([
      expect.objectContaining({ _tag: "NotDocument", path: ["type"] }),
    ]);
  });

  test.each<[string, CampaignBodyNode]>([
    ["a node outside the content set", doc({ type: "table" })],
    [
      "a mark outside the content set",
      doc(paragraph(text("x", [{ type: "strike" }]))),
    ],
    ["invalid nesting", doc({ type: "bulletList", content: [text("x")] })],
  ])("rejects %s as invalid structure", (_name, body) => {
    expect(issueTags(body)).toEqual(["StructureInvalid"]);
  });

  test("checks the rules only on a body whose structure is valid", () => {
    expect(issueTags(doc(link("http://a"), { type: "table" }))).toEqual([
      "StructureInvalid",
    ]);
  });

  test.each([
    "javascript:alert(1)",
    "http://workspace.deskohub.cz",
    "data:text/html,hi",
    "/relative",
    null,
  ])("rejects the link %p", (href) => {
    expect(campaignBodyIssues(doc(link(href)), imageCloudName)).toEqual([
      expect.objectContaining({
        _tag: "LinkHrefInvalid",
        path: ["content", 0, "content", 0, "marks", 0, "attrs", "href"],
      }),
    ]);
  });

  test.each([
    "https://example.com/image.jpg",
    "https://res.cloudinary.com/another-cloud/image/upload/v1/a.jpg",
    "http://res.cloudinary.com/synthetic-cloud/image/upload/v1/a.jpg",
    "https://res.cloudinary.com/synthetic-cloud/video/upload/v1/a.mp4",
  ])("rejects the image %s", (src) => {
    expect(campaignBodyIssues(doc(image(src)), imageCloudName)).toEqual([
      expect.objectContaining({
        _tag: "ImageSourceInvalid",
        path: ["content", 0, "attrs", "src"],
      }),
    ]);
  });

  test("rejects every image without a configured Cloudinary account", () => {
    expect(issueTags(doc(image(cloudinaryImage)), Option.none())).toEqual([
      "ImageSourceInvalid",
    ]);
    expect(issueTags(doc(paragraph(text("x"))), Option.none())).toEqual([]);
  });

  test("rejects a button without a label", () => {
    expect(
      issueTags(doc(cta({ label: "  ", href: "https://deskohub.cz" })))
    ).toEqual(["ButtonLabelMissing"]);
  });

  test.each(["Book\rnow", "Book\r\nnow"])(
    "rejects the button label %p, which Markdown can't keep",
    (label) => {
      expect(
        issueTags(doc(cta({ label, href: "https://deskohub.cz" })))
      ).toEqual(["ButtonLabelLineBreaks"]);
    }
  );

  test.each([null, "javascript:void(0)"])(
    "rejects the button URL %p",
    (href) => {
      expect(
        campaignBodyIssues(doc(cta({ label: "Klik", href })), imageCloudName)
      ).toEqual([
        expect.objectContaining({
          _tag: "ButtonHrefInvalid",
          path: ["content", 0, "attrs", "href"],
        }),
      ]);
    }
  );

  test("reports every issue in document order", () => {
    expect(
      issueTags(
        doc(
          link("http://a"),
          image("https://example.com/a.png"),
          cta({ label: " ", href: "ftp://x" }),
          {
            type: "bulletList",
            content: [{ type: "listItem", content: [link("data:x")] }],
          }
        )
      )
    ).toEqual([
      "LinkHrefInvalid",
      "ImageSourceInvalid",
      "ButtonLabelMissing",
      "ButtonHrefInvalid",
      "LinkHrefInvalid",
    ]);
  });
});

describe("campaignBodyStructureIssues", () => {
  test("leaves unfinished links, images and buttons to the full rules", () => {
    expect(
      campaignBodyStructureIssues(
        doc(link("http://a"), image("https://example.com/a.png"), cta({}))
      )
    ).toEqual([]);
  });
});

describe("campaignButtonLabelIssue", () => {
  test.each<[string, string | null, string | undefined]>([
    ["a label", "Rezervovat", undefined],
    ["a line feed", "Book\nnow", undefined],
    ["no label", null, "ButtonLabelMissing"],
    ["a blank label", " ", "ButtonLabelMissing"],
    ["a carriage return", "Book\rnow", "ButtonLabelLineBreaks"],
  ])("judges %s", (_name, label, tag) => {
    expect(
      Option.getOrUndefined(
        Option.map(
          campaignButtonLabelIssue(label, ["label"]),
          ({ _tag }) => _tag
        )
      )
    ).toBe(tag);
  });
});

describe("isCampaignLinkHref", () => {
  test.each<[string | null, boolean]>([
    ["https://deskohub.cz", true],
    [`mailto:${testEmailAddress("team")}`, true],
    ["http://deskohub.cz", false],
    ["javascript:alert(1)", false],
    ["deskohub.cz", false],
    [null, false],
  ])("judges %p", (href, expected) => {
    expect(isCampaignLinkHref(href)).toBe(expected);
  });
});

describe("isCampaignBodyEmpty", () => {
  test.each<[string, CampaignBodyNode, boolean]>([
    ["the body nobody has written", emptyCampaignBody, true],
    ["blank text", doc(paragraph(text("   "))), true],
    ["text", doc(paragraph(text("Ahoj"))), false],
    ["an image", doc(image(cloudinaryImage)), false],
    ["a button", doc(cta({ label: "", href: "" })), false],
    ["a rule", doc({ type: "horizontalRule" }), false],
  ])("judges %s", (_name, body, expected) => {
    expect(isCampaignBodyEmpty(body)).toBe(expected);
  });

  test("the body nobody has written passes the rules", () => {
    expect(issueTags(emptyCampaignBody)).toEqual([]);
  });
});
