import { describe, expect, test } from "bun:test";
import { getWorkspacePageUrl } from "./page-url";

describe("getWorkspacePageUrl", () => {
  test("addresses a page on the production origin without a locale", () => {
    expect(getWorkspacePageUrl("/faq")).toBe(
      "https://workspace.deskohub.cz/faq"
    );
    expect(getWorkspacePageUrl("/")).toBe("https://workspace.deskohub.cz/");
  });

  test("drops a locale prefix", () => {
    expect(getWorkspacePageUrl("/cs-CZ/reservation/cowork")).toBe(
      "https://workspace.deskohub.cz/reservation/cowork"
    );
    expect(getWorkspacePageUrl("/en-US")).toBe(
      "https://workspace.deskohub.cz/"
    );
  });

  test("keeps the query and fragment of the path", () => {
    expect(getWorkspacePageUrl("/cs-CZ/contact?topic=ttrpg#contact-form")).toBe(
      "https://workspace.deskohub.cz/contact?topic=ttrpg#contact-form"
    );
    expect(getWorkspacePageUrl("/en-US#overview")).toBe(
      "https://workspace.deskohub.cz/#overview"
    );
  });

  test("keeps the search parameters", () => {
    expect(getWorkspacePageUrl("/reservation/cowork", { tier: "pro" })).toBe(
      "https://workspace.deskohub.cz/reservation/cowork?tier=pro"
    );
  });
});
