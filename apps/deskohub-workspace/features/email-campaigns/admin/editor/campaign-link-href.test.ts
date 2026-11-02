import { describe, expect, test } from "bun:test";
import { normalizeCampaignLinkHref } from "./campaign-link-href";

describe("normalizeCampaignLinkHref", () => {
  test("keeps a complete https: or mailto: link as typed, trimmed", () => {
    expect(
      normalizeCampaignLinkHref("  https://workspace.deskohub.cz/faq ")
    ).toBe("https://workspace.deskohub.cz/faq");
    expect(normalizeCampaignLinkHref("mailto:team@deskohub.test")).toBe(
      "mailto:team@deskohub.test"
    );
  });

  test("turns a bare email address into a mailto: link", () => {
    expect(normalizeCampaignLinkHref(" team@deskohub.test ")).toBe(
      "mailto:team@deskohub.test"
    );
  });

  test("turns a bare host or path into an https: link", () => {
    expect(normalizeCampaignLinkHref("workspace.deskohub.cz/faq")).toBe(
      "https://workspace.deskohub.cz/faq"
    );
  });

  test("rejects a link with another scheme", () => {
    expect(normalizeCampaignLinkHref("http://workspace.deskohub.cz")).toBe(
      undefined
    );
    expect(normalizeCampaignLinkHref("javascript:alert(1)")).toBe(undefined);
  });

  test("rejects what still isn't a URL once completed", () => {
    expect(normalizeCampaignLinkHref("")).toBe(undefined);
    expect(normalizeCampaignLinkHref("not a link")).toBe(undefined);
  });
});
