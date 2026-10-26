import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect } from "effect";
import { renderMagicLinkEmail } from "./magic-link-email";

const customerEmail = testEmailAddress("ada");

const requestFor = (locale: "en-US" | "cs-CZ") => ({
  email: customerEmail,
  url: "https://workspace.example/api/auth/magic-link/verify?token=preview-token",
  locale,
});

describe("Magic-link email renderer", () => {
  test("embeds the bearer URL only in the rendered body", async () => {
    const rendered = await Effect.runPromise(
      renderMagicLinkEmail(requestFor("en-US"))
    );

    expect(rendered.html).toContain("token=preview-token");
    expect(rendered.subject).not.toContain("token=");
    expect(rendered.subject).not.toContain(customerEmail);
  });

  test.each([
    ["en-US", "Or enter this code:", "The code expires in 10 minutes."],
    ["cs-CZ", "Nebo zadej tento kód:", "Kód platí 10 minut."],
  ] as const)(
    "puts the %s sign-in code alone on exactly one bare text line",
    async (locale, intro, expiry) => {
      const rendered = await Effect.runPromise(
        renderMagicLinkEmail({ ...requestFor(locale), code: "482913" })
      );

      expect(rendered.text.match(/^[ \t]*\d{6}[ \t]*$/gm)).toEqual(["482913"]);
      expect(rendered.text).toContain(intro);
      expect(rendered.text).toContain(expiry);
      expect(rendered.html).toMatch(
        /<span[^>]*>482<\/span><span[^>]*>913<\/span>/
      );
      expect(rendered.subject).not.toContain("482913");
    }
  );

  test("renders the link-only email unchanged without a code", async () => {
    const linkOnly = await Effect.runPromise(
      renderMagicLinkEmail(requestFor("en-US"))
    );

    expect(linkOnly.text).not.toMatch(/^\s*\d{6}\s*$/m);
    expect(linkOnly.text).toContain("token=preview-token");
  });
});
