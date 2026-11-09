import { describe, expect, test } from "bun:test";
import { legalDocuments, legalDocumentUrl } from "./legal-documents";

describe("legalDocumentUrl", () => {
  test("links every document on the configured origin without a locale", () => {
    const urls = legalDocuments.map((document) =>
      legalDocumentUrl(document, "https://workspace.deskohub.cz")
    );

    expect(urls).toEqual([
      "https://workspace.deskohub.cz/privacy-policy",
      "https://workspace.deskohub.cz/marketing-communications",
      "https://workspace.deskohub.cz/terms-and-conditions",
      "https://workspace.deskohub.cz/cookie-policy",
    ]);
  });

  test("follows a preview or local origin", () => {
    expect(
      legalDocumentUrl(
        "privacy",
        "https://deskohub-workspace-git-branch.vercel.app"
      )
    ).toBe("https://deskohub-workspace-git-branch.vercel.app/privacy-policy");
    expect(legalDocumentUrl("terms", "http://10.0.2.2:3000")).toBe(
      "http://10.0.2.2:3000/terms-and-conditions"
    );
  });
});
