import { describe, expect, test } from "bun:test";
import type { CampaignBodyDocument } from "./campaign-body-document";
import type { CampaignContent } from "./campaign-content";
import { hashCampaignContent } from "./campaign-content-hash";

const body = (text: string): CampaignBodyDocument => ({
  formatVersion: 1,
  doc: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text,
            marks: [
              {
                type: "link",
                attrs: { href: "https://deskohub.cz", title: null },
              },
            ],
          },
        ],
      },
    ],
  },
});

const content: CampaignContent = {
  purpose: "marketing",
  templateKey: "workspace",
  locales: {
    "cs-CZ": { subject: "Ahoj", preheader: "Novinky", body: body("Čau") },
    "en-US": { subject: "Hello", preheader: "News", body: body("Hi") },
  },
};

describe("hashCampaignContent", () => {
  test("is a stable SHA-256 hex digest", () => {
    expect(hashCampaignContent(content)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCampaignContent(content)).toBe(
      hashCampaignContent(structuredClone(content))
    );
  });

  test("treats an undefined field like an absent one", () => {
    const withUndefined: CampaignContent = {
      ...content,
      locales: {
        ...content.locales,
        "en-US": {
          subject: "Hello",
          preheader: "News",
          body: {
            formatVersion: 1,
            doc: { ...body("Hi").doc, attrs: undefined },
          },
        },
      },
    };

    expect(hashCampaignContent(withUndefined)).toBe(
      hashCampaignContent(content)
    );
  });

  test("ignores key order", () => {
    const reordered: CampaignContent = {
      locales: {
        "en-US": {
          body: {
            doc: {
              content: [
                {
                  content: [
                    {
                      marks: [
                        {
                          attrs: { title: null, href: "https://deskohub.cz" },
                          type: "link",
                        },
                      ],
                      text: "Hi",
                      type: "text",
                    },
                  ],
                  type: "paragraph",
                },
              ],
              type: "doc",
            },
            formatVersion: 1,
          },
          preheader: "News",
          subject: "Hello",
        },
        "cs-CZ": { preheader: "Novinky", subject: "Ahoj", body: body("Čau") },
      },
      templateKey: "workspace",
      purpose: "marketing",
    };

    expect(hashCampaignContent(reordered)).toBe(hashCampaignContent(content));
  });

  test.each<[string, CampaignContent]>([
    ["purpose", { ...content, purpose: "operational" }],
    [
      "subject",
      {
        ...content,
        locales: {
          ...content.locales,
          "en-US": { subject: "Hello!", preheader: "News", body: body("Hi") },
        },
      },
    ],
    [
      "preheader",
      {
        ...content,
        locales: {
          ...content.locales,
          "cs-CZ": {
            subject: "Ahoj",
            preheader: "Novinky!",
            body: body("Čau"),
          },
        },
      },
    ],
    [
      "body",
      {
        ...content,
        locales: {
          ...content.locales,
          "cs-CZ": {
            subject: "Ahoj",
            preheader: "Novinky",
            body: body("Čau!"),
          },
        },
      },
    ],
    [
      "operational reason",
      {
        ...content,
        locales: {
          ...content.locales,
          "cs-CZ": {
            ...content.locales["cs-CZ"]!,
            operationalReason: "Měníme provozní dobu.",
          },
        },
      },
    ],
    [
      "removed locale",
      { ...content, locales: { "cs-CZ": content.locales["cs-CZ"] } },
    ],
  ])("changes with the %s", (_field, changed) => {
    expect(hashCampaignContent(changed)).not.toBe(hashCampaignContent(content));
  });
});
