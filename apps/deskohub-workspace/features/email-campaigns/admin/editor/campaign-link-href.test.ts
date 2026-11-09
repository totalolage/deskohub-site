import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { normalizeCampaignLinkHref } from "./campaign-link-href";

const address = testEmailAddress("team");

describe("normalizeCampaignLinkHref", () => {
  test("keeps a complete https: or mailto: link as typed, trimmed", () => {
    expect(
      normalizeCampaignLinkHref("  https://workspace.deskohub.cz/faq ")
    ).toBe("https://workspace.deskohub.cz/faq");
    expect(normalizeCampaignLinkHref(`mailto:${address}`)).toBe(
      `mailto:${address}`
    );
  });

  test("turns a bare email address into a mailto: link", () => {
    expect(normalizeCampaignLinkHref(` ${address} `)).toBe(`mailto:${address}`);
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
