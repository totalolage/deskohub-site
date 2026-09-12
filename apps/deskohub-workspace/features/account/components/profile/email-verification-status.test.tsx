import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { EmailVerificationStatus } from "./email-verification-status";

const copy = {
  unverified: "This email still needs verification.",
  verified: "This email has been successfully verified.",
};

function renderStatus(emailVerified: boolean): string {
  return renderToStaticMarkup(
    <EmailVerificationStatus copy={copy} emailVerified={emailVerified} />
  );
}

function extractButton(markup: string): string {
  const button = markup.match(/<button\b[^>]*>/)?.[0];
  if (!button) throw new Error("Expected an email verification button");
  return button;
}

describe("EmailVerificationStatus", () => {
  test("renders a focusable verified icon button with its explanatory copy", () => {
    const markup = renderStatus(true);
    const button = extractButton(markup);

    expect(button).toContain('type="button"');
    expect(button).toContain(`aria-label="${copy.verified}"`);
    expect(button).toContain("size-8");
    expect(button).toContain("focus-visible:ring-2");
    expect(button).toContain("text-emerald-800");
    expect(button).not.toContain('tabindex="-1"');
    expect(markup).toContain("lucide-circle-check");
    expect(markup).not.toMatch(
      new RegExp(`>\\s*${copy.verified.replaceAll(".", "\\.")}\\s*<`)
    );
  });

  test("renders an amber alert icon for an unverified email", () => {
    const markup = renderStatus(false);
    const button = extractButton(markup);

    expect(button).toContain('type="button"');
    expect(button).toContain(`aria-label="${copy.unverified}"`);
    expect(button).toContain("text-amber-800");
    expect(button).not.toContain('tabindex="-1"');
    expect(markup).toContain("lucide-circle-alert");
  });
});
