import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
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
