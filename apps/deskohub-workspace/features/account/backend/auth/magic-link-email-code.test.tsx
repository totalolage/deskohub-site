import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect } from "effect";
import { m } from "@/features/i18n";
import { renderMagicLinkEmail } from "./magic-link-email";

const customerEmail = testEmailAddress("ada");
const signInUrl =
  "https://workspace.example/api/auth/magic-link/verify?token=preview-token";

const requestFor = (locale: "en-US" | "cs-CZ") => ({
  email: customerEmail,
  url: signInUrl,
  locale,
});

describe("magic-link email sign-in code", () => {
  test.each(["en-US", "cs-CZ"] as const)(
    "renders the code and localized instructions for %s",
    async (locale) => {
      const code = "482913";
      const rendered = await Effect.runPromise(
        renderMagicLinkEmail({ ...requestFor(locale), code })
      );
      const sixDigitLines = rendered.text
        .split(/\r?\n/)
        .filter((line) => /^\s*\d{6}\s*$/.test(line));

      expect(rendered.text.split(/\r?\n/).map((line) => line.trim())).toContain(
        code
      );
      expect(sixDigitLines.map((line) => line.trim())).toEqual([code]);
      expect(rendered.text).toContain(
        m.accountMagicLinkEmailCodeIntro({}, { locale })
      );
      expect(rendered.text).toContain(
        m.accountMagicLinkEmailCodeExpiry({}, { locale })
      );
      expect(rendered.html).toMatch(/<span[^>]*>482<\/span>/);
      expect(rendered.html).toMatch(/<span[^>]*>913<\/span>/);
      expect(rendered.html).toContain(signInUrl);
    }
  );

  test.each(["en-US", "cs-CZ"] as const)(
    "omits code instructions and code lines for %s when there is no code",
    async (locale) => {
      const rendered = await Effect.runPromise(
        renderMagicLinkEmail(requestFor(locale))
      );

      expect(rendered.text).not.toContain(
        m.accountMagicLinkEmailCodeIntro({}, { locale })
      );
      expect(rendered.text).not.toContain(
        m.accountMagicLinkEmailCodeExpiry({}, { locale })
      );
      expect(rendered.html).not.toContain(
        m.accountMagicLinkEmailCodeIntro({}, { locale })
      );
      expect(rendered.html).not.toContain(
        m.accountMagicLinkEmailCodeExpiry({}, { locale })
      );
      expect(rendered.text).not.toMatch(/^\s*\d{6}\s*$/m);
    }
  );
});
