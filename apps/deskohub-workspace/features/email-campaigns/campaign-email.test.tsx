import { describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect } from "effect";
import { env } from "@/env";
import { m } from "@/features/i18n";
import { getRuntimeMarketingPreferencesPlaceholderUrl } from "@/features/legal/marketing-preferences-access-url";
import type { CampaignBodyNode } from "./body/campaign-body-document";
import type {
  CampaignLocaleContent,
  CampaignPurpose,
} from "./body/campaign-content";
import {
  CampaignDeliveryAudience,
  CampaignEmailOccasion,
  campaignEmailKind,
  campaignEmailMessage,
  renderCampaignEmailPreview,
} from "./campaign-email";
import type {
  CampaignConfirmationCode,
  CampaignSendId,
} from "./campaign-identifiers";

const cloudinaryImage =
  "https://res.cloudinary.com/cloud/image/upload/v1/campaigns/autumn.jpg";
const bookingUrl = "https://workspace.deskohub.cz/cs-CZ/meeting-room";
const unsubscribeUrl =
  "https://workspace.deskohub.cz/api/email-campaigns/unsubscribe?token=t0k3n&x=1";

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
  purpose: CampaignPurpose = "operational",
  locale = "cs-CZ" as const,
  localeContent: CampaignLocaleContent = content
) =>
  Effect.runPromise(
    renderCampaignEmailPreview({
      templateKey: "workspace",
      purpose,
      locale,
      content: localeContent,
    })
  );

const sender = {
  from: { email: testEmailAddress("campaigns"), name: "Deskohub Workspace" },
  replyTo: { email: testEmailAddress("hello") },
};
const recipient = {
  sendId: "send-1" as CampaignSendId,
  dotyposCustomerId: DotyposCustomerIdSchema.make("42"),
};
const code = "ABCD-EFGH" as CampaignConfirmationCode;

const message = (
  occasion: CampaignEmailOccasion,
  options: {
    readonly locale?: "cs-CZ" | "en-US";
    readonly localeContent?: CampaignLocaleContent;
    readonly deploymentEnvironment?: string;
  } = {}
) =>
  Effect.runPromise(
    campaignEmailMessage({
      templateKey: "workspace",
      locale: options.locale ?? "cs-CZ",
      content: options.localeContent ?? content,
      occasion,
      sender,
      deploymentEnvironment: options.deploymentEnvironment ?? "preview",
    })
  );

const delivery = (audience: CampaignDeliveryAudience) =>
  CampaignEmailOccasion.Delivery({
    to: testEmailAddress("ada"),
    recipient,
    audience,
  });

const attribute = (url: string) => url.replaceAll("&", "&amp;");

const placeholderPreferencesUrl = () =>
  Effect.runPromise(getRuntimeMarketingPreferencesPlaceholderUrl);

const syntheticBypassSecret = "synthetic-campaign-bypass-secret";

/** Runs `run` on a preview deployment that has an automation bypass secret. */
const withPreviewBypassSecret = async <A,>(run: () => Promise<A>) => {
  const previous = {
    VERCEL_ENV: env.VERCEL_ENV,
    VERCEL_AUTOMATION_BYPASS_SECRET: env.VERCEL_AUTOMATION_BYPASS_SECRET,
  };
  Object.assign(env, {
    VERCEL_ENV: "preview",
    VERCEL_AUTOMATION_BYPASS_SECRET: syntheticBypassSecret,
  });
  try {
    return await run();
  } finally {
    Object.assign(env, previous);
  }
};

const operationalReason = "Píšeme vám kvůli změně provozní doby.";

describe("campaign email preview", () => {
  test("renders the body inside the Workspace layout", async () => {
    const email = await render();

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
    const email = await render();
    const listItems = email.html.match(/<li[^>]*>[\s\S]*?<\/li>/g) ?? [];

    expect(listItems).toHaveLength(3);
    for (const listItem of listItems) {
      expect(listItem).toMatch(/<li[^>]*><p[^>]*style="[^"]*margin:0/);
    }
  });

  test("renders a readable plain-text version", async () => {
    const email = await render();

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

  test("links a marketing preview to the placeholder preferences page", async () => {
    const email = await render("marketing");
    const preferencesUrl = await placeholderPreferencesUrl();

    expect(preferencesUrl).toContain("token=preview");
    expect(email.html).toContain(`href="${attribute(preferencesUrl)}"`);
    expect(email.html).toContain(
      m.emailCampaignMarketingFooterLink({}, { locale: "cs-CZ" })
    );
    expect(email.text).toContain(preferencesUrl);
    expect(email.html).not.toContain(
      m.emailCampaignOperationalFooter({}, { locale: "cs-CZ" })
    );
  });

  test("keeps the preview protection bypass out of a marketing preview", async () => {
    const email = await withPreviewBypassSecret(() => render("marketing"));

    for (const body of [email.html, email.text]) {
      expect(body).not.toContain(syntheticBypassSecret);
      expect(body).not.toContain("x-vercel-protection-bypass");
    }
  });

  test("gives an operational preview a reason line and no preferences link", async () => {
    const email = await render();

    expect(email.html).toContain(
      m.emailCampaignOperationalFooter({}, { locale: "cs-CZ" })
    );
    expect(email.html).not.toContain("marketing-preferences");
    expect(email.html).not.toContain(
      m.emailCampaignMarketingFooterLink({}, { locale: "cs-CZ" })
    );
  });

  test("replaces the operational reason line with the campaign's own", async () => {
    const email = await render("operational", "cs-CZ", {
      ...content,
      operationalReason,
    });

    expect(email.html).toContain(operationalReason);
    expect(email.text).toContain(operationalReason);
    expect(email.html).not.toContain(
      m.emailCampaignOperationalFooter({}, { locale: "cs-CZ" })
    );
  });

  test("ignores the operational reason in a marketing email", async () => {
    const email = await render("marketing", "cs-CZ", {
      ...content,
      operationalReason,
    });

    expect(email.html).not.toContain(operationalReason);
    expect(email.html).toContain(
      m.emailCampaignMarketingFooterLink({}, { locale: "cs-CZ" })
    );
  });

  test("localizes the footer", async () => {
    const email = await render("marketing", "en-US");

    expect(email.html).toContain('lang="en-US"');
    expect(email.html).toContain(
      m.emailCampaignMarketingFooterLink({}, { locale: "en-US" })
    );
  });

  test("has no test notice", async () => {
    const email = await render("marketing");

    expect(email.subject).toBe(content.subject);
    expect(email.html).not.toContain(
      m.emailCampaignTestNotice({ code }, { locale: "cs-CZ" })
    );
  });
});

describe("campaign test email", () => {
  const testOccasion = (
    purpose: CampaignPurpose,
    to = testEmailAddress("admin")
  ) => CampaignEmailOccasion.Test({ to, purpose, code });

  test("marks the subject, leads with the code, and carries no delivery tags or headers", async () => {
    const email = await message(testOccasion("operational"));

    expect(email.to).toEqual({ email: testEmailAddress("admin") });
    expect(email.subject).toBe(`[TEST] ${content.subject}`);
    expect(email.html).toContain(
      m.emailCampaignTestNotice({ code }, { locale: "cs-CZ" })
    );
    expect(email.text).toContain(code);
    expect(email.headers).toBeUndefined();
    expect(email.metadata).toBeUndefined();
    expect(email.tags).toEqual(["email-campaign-test"]);
    expect(email.sensitiveContent).toBe(false);
  });

  test("links a marketing test email to the placeholder preferences page", async () => {
    const email = await message(testOccasion("marketing"));

    expect(email.html).toContain(
      `href="${attribute(await placeholderPreferencesUrl())}"`
    );
    expect(email.headers).toBeUndefined();
  });

  test("keeps the preview protection bypass out of a marketing test email whose body providers log", async () => {
    const email = await withPreviewBypassSecret(() =>
      message(testOccasion("marketing"))
    );

    expect(email.sensitiveContent).toBe(false);
    expect(email.text).toContain(code);
    for (const body of [email.html, email.text]) {
      expect(body).not.toContain(syntheticBypassSecret);
      expect(body).not.toContain("x-vercel-protection-bypass");
    }
  });

  test("keeps the confirmation code out of production provider logs", async () => {
    const email = await message(testOccasion("operational"), {
      deploymentEnvironment: "production",
    });

    expect(email.sensitiveContent).toBe(true);
  });
});

describe("campaign delivery", () => {
  test("links a marketing footer to the one-click unsubscribe URL", async () => {
    const email = await message(
      delivery(CampaignDeliveryAudience.Marketing({ unsubscribeUrl }))
    );
    const footerLinks = [
      ...(email.html ?? "").matchAll(/href="([^"]*unsubscribe[^"]*)"/g),
    ].map(([, href]) => href);

    expect(email.headers).toEqual({
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    expect(footerLinks).toEqual([attribute(unsubscribeUrl)]);
    expect(email.text).toContain(unsubscribeUrl);
    expect(email.html).not.toContain("token=preview");
  });

  test("gives an operational email no unsubscribe headers or link", async () => {
    const email = await message(
      delivery(CampaignDeliveryAudience.Operational()),
      { localeContent: { ...content, operationalReason } }
    );

    expect(email.headers).toBeUndefined();
    expect(email.html).not.toContain("marketing-preferences");
    expect(email.html).not.toContain("unsubscribe");
    expect(email.html).toContain(operationalReason);
  });

  test("tags the frozen recipient for the delivery-status webhook", async () => {
    const email = await message(
      delivery(CampaignDeliveryAudience.Operational())
    );

    expect(email).toMatchObject({
      from: sender.from,
      replyTo: sender.replyTo,
      to: { email: testEmailAddress("ada") },
      subject: content.subject,
      tags: [campaignEmailKind.category],
      metadata: {
        campaignSendId: "send-1",
        dotyposCustomerId: "42",
        deploymentEnvironment: "preview",
      },
    });
    expect(email.sensitiveContent).toBeUndefined();
    expect(email.html).not.toContain(
      m.emailCampaignTestNotice({ code }, { locale: "cs-CZ" })
    );
  });
});

describe("campaign body images", () => {
  const renderImage = async (attrs: CampaignBodyNode["attrs"]) => {
    const email = await render("operational", "cs-CZ", {
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
