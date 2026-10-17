import { describe, expect, test } from "bun:test";
import { getWorkspaceAlternates } from "./alternates";

describe("getWorkspaceAlternates", () => {
  test("points the canonical at the page in its own locale", () => {
    expect(getWorkspaceAlternates("en-US", "/contact").canonical).toBe(
      "https://workspace.deskohub.cz/en-US/contact"
    );
    expect(getWorkspaceAlternates("cs-CZ", "/contact").canonical).toBe(
      "https://workspace.deskohub.cz/cs-CZ/contact"
    );
  });

  test("lists every locale and an unprefixed x-default", () => {
    expect(getWorkspaceAlternates("cs-CZ", "/contact").languages).toEqual({
      "en-US": "https://workspace.deskohub.cz/en-US/contact",
      "cs-CZ": "https://workspace.deskohub.cz/cs-CZ/contact",
      "x-default": "https://workspace.deskohub.cz/contact",
    });
  });

  test("addresses the home page without a trailing path", () => {
    expect(getWorkspaceAlternates("en-US")).toEqual({
      canonical: "https://workspace.deskohub.cz/en-US",
      languages: {
        "en-US": "https://workspace.deskohub.cz/en-US",
        "cs-CZ": "https://workspace.deskohub.cz/cs-CZ",
        "x-default": "https://workspace.deskohub.cz/",
      },
    });
  });

  test("accepts a pathname without a leading slash", () => {
    expect(
      getWorkspaceAlternates("en-US", "privacy-policy").languages["x-default"]
    ).toBe("https://workspace.deskohub.cz/privacy-policy");
  });
});
