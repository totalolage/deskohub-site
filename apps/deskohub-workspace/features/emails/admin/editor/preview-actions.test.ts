import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, test } from "bun:test";
import type { EmailDraft } from "@deskohub/workspace-admin-api";
import { emailDiscountSampleCode } from "@/features/emails/values/discount";
import { mockAdministrationActionRequest } from "@/shared/testing/workspace-action-request.test-utils";

const { access } = await mockAdministrationActionRequest({
  administrator: "email-preview",
  referer: "https://deskohub.test/en-US/admin",
});

const { previewEmailDraft } = await import("./preview-actions");

const ownImage =
  "https://res.cloudinary.com/cloud/image/upload/v1/email-campaigns/preview/own.jpg";
const foreignImage = "https://images.example.test/tracking.gif";

const draft = {
  purpose: "marketing",
  templateKey: "workspace",
  structure: [
    { _tag: "Paragraph", id: "intro", textKey: "intro" },
    { _tag: "Image", id: "own", src: ownImage, altKey: "own_alt" },
    { _tag: "Image", id: "foreign", src: foreignImage, altKey: "foreign_alt" },
    {
      _tag: "Offer",
      id: "offer",
      value: "offer",
      labelKey: "offer_label",
      href: "https://deskohub.cz/rezervace",
    },
  ],
  translations: {
    "en-US": {
      subject: [
        { _tag: "Text", text: "Hello " },
        { _tag: "Value", name: "first_name" },
      ],
      preheader: [{ _tag: "Text", text: "Autumn news" }],
      texts: {
        intro: [{ _tag: "Text", text: "Welcome back." }],
        own_alt: [{ _tag: "Text", text: "Our room" }],
        foreign_alt: [{ _tag: "Text", text: "Someone else's picture" }],
        offer_label: [{ _tag: "Text", text: "Book" }],
      },
    },
  },
  values: [
    {
      name: "first_name",
      source: {
        kind: "customer",
        path: ["profile", "customer", "displayName"],
      },
    },
    {
      name: "offer",
      source: {
        kind: "discount",
        discountId: "11111111-1111-4111-8111-111111111111",
        validDays: 14,
      },
    },
  ],
} satisfies typeof EmailDraft.Encoded;

beforeEach(() => {
  access.set("administrator");
});

describe("previewEmailDraft", () => {
  test("renders the draft with sample values and only the Deskohub account's images", async () => {
    const result = await previewEmailDraft({ draft, locale: "en-US" });

    expect(result?.data?.subject).toBe("Hello [displayName]");
    expect(result?.data?.html).toContain(emailDiscountSampleCode);
    expect(result?.data?.html).toContain(ownImage);
    expect(result?.data?.html).not.toContain(foreignImage);
  });

  test("shows the values the host prepared instead of samples", async () => {
    const result = await previewEmailDraft({
      draft,
      locale: "en-US",
      values: { first_name: { _tag: "Resolved", value: "Jana" } },
    });

    expect(result?.data?.subject).toBe("Hello Jana");
    expect(result?.data?.html).toContain(emailDiscountSampleCode);
  });

  test("answers prepared values of the wrong shape with a failure", async () => {
    const result = await previewEmailDraft({
      draft,
      locale: "en-US",
      values: { first_name: { _tag: "Resolved", value: { name: "Jana" } } },
    });

    expect(result?.data).toBeUndefined();
    expect(result?.serverError).toEqual(expect.any(String));
  });

  test.each(["signed-out", "not-administrator"] as const)(
    "refuses a %s caller without rendering",
    async (caller) => {
      access.set(caller);

      const result = await previewEmailDraft({ draft, locale: "en-US" });

      expect(result?.data).toBeUndefined();
      expect(result?.serverError).toEqual(expect.any(String));
    }
  );
});
