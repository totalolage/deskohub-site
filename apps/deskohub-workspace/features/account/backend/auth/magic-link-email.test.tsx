import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { renderMagicLinkEmail } from "./magic-link-email";

const requestFor = (locale: "en-US" | "cs-CZ") => ({
  email: "ada@example.test",
  url: "https://workspace.example/api/auth/magic-link/verify?token=preview-token",
  locale,
});

describe("Magic-link email renderer", () => {
  test("renders the localized subject and body for both locales", async () => {
    const en = await Effect.runPromise(
      renderMagicLinkEmail(requestFor("en-US"))
    );
    const cs = await Effect.runPromise(
      renderMagicLinkEmail(requestFor("cs-CZ"))
    );

    expect(en.subject).toBe("Your Deskohub Workspace sign-in link");
    expect(cs.subject).toBe("Přihlašovací odkaz do Deskohub Workspace");

    expect(en.html).toContain("Sign in");
    expect(en.text).toContain("Sign in");
    expect(cs.html).toContain("Přihlásit se");
    expect(cs.text).toContain("Přihlásit se");

    for (const rendered of [en, cs]) {
      expect(rendered.html).toContain("Deskohub");
      expect(rendered.html).toContain("Turnovská 430/10");
    }
  });

  test("embeds the bearer URL only in the rendered body", async () => {
    const rendered = await Effect.runPromise(
      renderMagicLinkEmail(requestFor("en-US"))
    );

    expect(rendered.html).toContain("token=preview-token");
    expect(rendered.subject).not.toContain("token=");
    expect(rendered.subject).not.toContain("ada@example.test");
  });
});
