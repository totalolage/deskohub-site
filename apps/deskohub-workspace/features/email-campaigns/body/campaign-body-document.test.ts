import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Option, Result, Schema } from "effect";
import {
  type CampaignBodyNode,
  campaignBodyDocument,
  UnfinishedCampaignBodyDocument,
} from "./campaign-body-document";

const body = (...content: ReadonlyArray<CampaignBodyNode>) => ({
  formatVersion: 1,
  doc: { type: "doc", content },
});

const text = (value: string, marks?: CampaignBodyNode["marks"]) =>
  marks ? { type: "text", text: value, marks } : { type: "text", text: value };

const paragraph = (...content: ReadonlyArray<CampaignBodyNode>) => ({
  type: "paragraph",
  content,
});

const link = (href: string) =>
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
  "https://res.cloudinary.com/cloud/image/upload/v1/campaigns/autumn.jpg";

const decode = Schema.decodeUnknownResult(
  campaignBodyDocument(Option.some("cloud"))
);

describe("campaignBodyDocument", () => {
  test("accepts every node and mark of the content set", () => {
    const document = body(
      { type: "heading", attrs: { level: 2 }, content: [text("Novinky")] },
      paragraph(
        text("tučně", [{ type: "bold" }]),
        text(" a "),
        text("kurzívou", [{ type: "italic" }])
      ),
      link("https://workspace.deskohub.cz"),
      link(`mailto:${testEmailAddress("campaign")}`),
      {
        type: "bulletList",
        content: [{ type: "listItem", content: [paragraph(text("jedna"))] }],
      },
      {
        type: "orderedList",
        attrs: { start: 1 },
        content: [{ type: "listItem", content: [paragraph(text("první"))] }],
      },
      image(cloudinaryImage),
      { type: "horizontalRule" },
      cta({ label: "Rezervovat", href: "https://workspace.deskohub.cz" })
    );

    expect(decode(document)).toEqual(Result.succeed(document));
  });

  test("rejects an unknown format version", () => {
    expect(Result.isFailure(decode({ ...body(), formatVersion: 2 }))).toBe(
      true
    );
  });

  test.each([
    ["a node outside the content set", body({ type: "table" })],
    ["an unsafe link", body(link("javascript:alert(1)"))],
    ["a foreign image", body(image("https://example.com/image.jpg"))],
    ["a button without a label", body(cta({ label: " ", href: null }))],
  ])("rejects %s", (_name, document) => {
    expect(Result.isFailure(decode(document))).toBe(true);
  });

  test("checks images against the account it was made for", () => {
    const document = body(image(cloudinaryImage));
    const decodeFor = (cloudName: Option.Option<string>) =>
      Result.isSuccess(
        Schema.decodeUnknownResult(campaignBodyDocument(cloudName))(document)
      );

    expect(decodeFor(Option.some("cloud"))).toBe(true);
    expect(decodeFor(Option.some("another-cloud"))).toBe(false);
    expect(decodeFor(Option.none())).toBe(false);
  });
});

describe("UnfinishedCampaignBodyDocument", () => {
  const decodeUnfinished = Schema.decodeUnknownResult(
    UnfinishedCampaignBodyDocument
  );

  test("accepts unfinished links, images and buttons", () => {
    const document = body(
      link("http://workspace.deskohub.cz"),
      image("https://example.com/image.jpg"),
      cta({ label: "", href: null })
    );

    expect(decodeUnfinished(document)).toEqual(Result.succeed(document));
  });

  test("rejects a node outside the content set", () => {
    expect(Result.isFailure(decodeUnfinished(body({ type: "table" })))).toBe(
      true
    );
  });
});
