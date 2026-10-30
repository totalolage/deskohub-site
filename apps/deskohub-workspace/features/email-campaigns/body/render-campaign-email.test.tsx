import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { CampaignBodyNode } from "./campaign-body-document";
import type { CampaignLocaleContent } from "./campaign-content";
import {
  CampaignEmailFooter,
  renderCampaignEmail,
} from "./render-campaign-email";

const cloudinaryImage =
  "https://res.cloudinary.com/cloud/image/upload/v1/campaigns/autumn.jpg";
const bookingUrl = "https://workspace.deskohub.cz/cs-CZ/meeting-room";
const preferencesUrl =
  "https://workspace.deskohub.cz/cs-CZ/marketing-preferences/access?token=t0k3n";

const text = (value: string) => ({ type: "text", text: value });
const paragraph = (value: string) => ({
  type: "paragraph",
  content: [text(value)],
});

const content: CampaignLocaleContent = {
  subject: "Podzim ve Workspace",
  preheader: "Nové zasedačky a delší otevírací doba",
  body: {
    formatVersion: 1,
    doc: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [text("Podzimní novinky")],
        },
        {
          type: "paragraph",
          content: [
            text("Přečtěte si "),
            {
              type: "text",
              text: "program",
              marks: [
                {
                  type: "link",
                  attrs: {
                    href: "https://workspace.deskohub.cz/program",
                    title: null,
                  },
                },
              ],
            },
            text(" a "),
            { type: "text", text: "nezapomeňte", marks: [{ type: "bold" }] },
            text("."),
          ],
        },
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [paragraph("Zasedačka pro osm")] },
            { type: "listItem", content: [paragraph("Otevřeno do 22:00")] },
          ],
        },
        {
          type: "orderedList",
          attrs: { start: 1 },
          content: [{ type: "listItem", content: [paragraph("Rezervujte")] }],
        },
        {
          type: "image",
          attrs: { src: cloudinaryImage, alt: "Nová zasedačka", title: null },
        },
        { type: "horizontalRule" },
        {
          type: "ctaButton",
          attrs: { label: "Rezervovat", href: bookingUrl },
        },
      ],
    },
  },
};

const render = (
  footer: CampaignEmailFooter,
  locale = "cs-CZ" as const,
  localeContent: CampaignLocaleContent = content
) =>
  Effect.runPromise(
    renderCampaignEmail({
      templateKey: "workspace",
      locale,
      content: localeContent,
      footer,
    })
  );

const operationalReason = "Píšeme vám kvůli změně provozní doby.";

describe("renderCampaignEmail", () => {
  test("renders the body inside the Workspace layout", async () => {
    const email = await render(CampaignEmailFooter.Operational());

    expect(email.subject).toBe(content.subject);
    expect(email.html).toContain('lang="cs-CZ"');
    expect(email.html).toContain("Turnovská 430/10");
    expect(email.html).toContain(content.preheader);
    expect(email.html).toMatch(/<h1[^>]*>Podzimní novinky<\/h1>/);
    expect(email.html).toContain(
      'href="https://workspace.deskohub.cz/program"'
    );
    expect(email.html).toContain("<strong>nezapomeňte</strong>");
    expect(email.html).toMatch(/<ul[^>]*>/);
    expect(email.html).toMatch(/<ol[^>]*start="1"/);
    expect(email.html).toContain(`src="${cloudinaryImage}"`);
    expect(email.html).toContain('alt="Nová zasedačka"');
    expect(email.html).toMatch(/<hr[^>]*>/);
    expect(email.html).toMatch(
      new RegExp(`<a[^>]*href="${bookingUrl}"[^>]*>[\\s\\S]*Rezervovat`)
    );
  });

  test("renders list-item paragraphs without block margins", async () => {
    const email = await render(CampaignEmailFooter.Operational());
    const listItems = email.html.match(/<li[^>]*>[\s\S]*?<\/li>/g) ?? [];

    expect(listItems).toHaveLength(3);
    for (const listItem of listItems) {
      expect(listItem).toMatch(/<li[^>]*><p[^>]*style="[^"]*margin:0/);
    }
  });

  test("renders a readable plain-text version", async () => {
    const email = await render(CampaignEmailFooter.Operational());

    expect(email.text).not.toMatch(/<[a-z]/i);
    expect(email.text).toContain("PODZIMNÍ NOVINKY");
    expect(email.text).toContain(
      "Přečtěte si program https://workspace.deskohub.cz/program a nezapomeňte."
    );
    expect(email.text).toMatch(
      /\* Zasedačka pro osm\n+\s*\* Otevřeno do 22:00/
    );
    expect(email.text).toContain("1. Rezervujte");
    expect(email.text).toContain(`Rezervovat ${bookingUrl}`);
  });

  test("gives a marketing email an unsubscribe link", async () => {
    const email = await render(
      CampaignEmailFooter.Marketing({ marketingPreferencesUrl: preferencesUrl })
    );

    expect(email.html).toContain(
      `href="${preferencesUrl.replace("&", "&amp;")}"`
    );
    expect(email.html).toContain("Odhlásit odběr nebo změnit nastavení");
    expect(email.text).toContain(preferencesUrl);
    expect(email.html).not.toContain("provozní sdělení");
  });

  test("gives an operational email a reason line and no unsubscribe link", async () => {
    const email = await render(CampaignEmailFooter.Operational());

    expect(email.html).toContain("Toto provozní sdělení ti posíláme");
    expect(email.html).not.toContain("marketing-preferences");
    expect(email.html).not.toContain("Odhlásit odběr");
  });

  test("replaces the operational reason line with the campaign's own", async () => {
    const email = await render(CampaignEmailFooter.Operational(), "cs-CZ", {
      ...content,
      operationalReason,
    });

    expect(email.html).toContain(operationalReason);
    expect(email.text).toContain(operationalReason);
    expect(email.html).not.toContain("Toto provozní sdělení ti posíláme");
  });

  test("ignores the operational reason in a marketing email", async () => {
    const email = await render(
      CampaignEmailFooter.Marketing({
        marketingPreferencesUrl: preferencesUrl,
      }),
      "cs-CZ",
      { ...content, operationalReason }
    );

    expect(email.html).not.toContain(operationalReason);
    expect(email.html).toContain("Odhlásit odběr nebo změnit nastavení");
  });

  test("localizes the footer", async () => {
    const email = await render(
      CampaignEmailFooter.Marketing({
        marketingPreferencesUrl: preferencesUrl,
      }),
      "en-US"
    );

    expect(email.html).toContain('lang="en-US"');
    expect(email.html).toContain("Unsubscribe or change your preferences");
  });
});

describe("campaign body images", () => {
  const renderImage = async (attrs: CampaignBodyNode["attrs"]) => {
    const email = await render(CampaignEmailFooter.Operational(), "cs-CZ", {
      ...content,
      body: {
        formatVersion: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: "image",
              attrs: {
                src: cloudinaryImage,
                alt: "Zasedačka",
                title: null,
                ...attrs,
              },
            },
          ],
        },
      },
    });
    const image = email.html.match(/<img[^>]*alt="Zasedačka"[^>]*>/)?.[0];
    if (image === undefined) throw new Error("The image did not render");
    const cell = email.html.match(
      /<td([^>]*\balign="[^"]*"[^>]*)>\s*<img[^>]*alt="Zasedačka"[^>]*>/
    )?.[1];
    return { image, cell };
  };

  test.each([
    ["left", undefined],
    ["center", "margin-right:auto;margin-left:auto"],
    ["right", "margin-left:auto;margin-right:0"],
  ] as const)(
    "aligns a %s image in its cell for every client",
    async (align, margins) => {
      const { image, cell } = await renderImage({ align, width: 240 });

      expect(cell).toContain(`align="${align}"`);
      expect(cell).toContain(`text-align:${align}`);
      expect(image).toContain('width="240"');
      expect(image).toMatch(/style="[^"]*display:block/);
      expect(image).toMatch(/style="[^"]*max-width:100%/);
      expect(image).not.toMatch(/style="[^"]*[;"]width:100%/);
      if (margins === undefined)
        expect(image).not.toMatch(/margin-(left|right):auto/);
      else expect(image).toContain(margins);
    }
  );

  test("caps a wide image at the body column", async () => {
    const { image } = await renderImage({ align: "center", width: 1200 });

    expect(image).toContain('width="534"');
  });

  test("centers an image whose alignment is missing or unknown", async () => {
    for (const attrs of [{}, { align: null }, { align: "justify" }]) {
      const { cell } = await renderImage({ ...attrs, width: 240 });

      expect(cell).toContain('align="center"');
    }
  });

  test("keeps an image without a width filling the column, whatever its alignment", async () => {
    const legacy = await renderImage({});

    expect(legacy.cell).toBeUndefined();
    expect(legacy.image).toContain('width="534"');
    expect(legacy.image).toMatch(/style="[^"]*;width:100%;max-width:100%/);
    for (const align of ["left", "center", "right"]) {
      expect(await renderImage({ align, width: null })).toEqual(legacy);
    }
  });
});
