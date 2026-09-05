import { describe, expect, test } from "bun:test";

const readWorkspaceFile = (path: string) =>
  Bun.file(new URL(path, import.meta.url)).text();

describe("access codes admin route boundary", () => {
  test("renders the form through the cached administration page boundary", async () => {
    const page = await readWorkspaceFile("./page.tsx");

    expect(page).toContain("await authorizeAdministratorPage()");
    expect(page).toContain("<Suspense");
    expect(page).not.toContain("requireDiscountAdminAuthorization");
    expect(page).not.toContain("basic-auth");
    expect(page).not.toContain("ADMIN_BASIC_AUTH_SHA256");
  });

  test("keeps the streamed card in the local suspense boundary", async () => {
    const page = await readWorkspaceFile("./page.tsx");

    expect(page).toContain("AuthorizedAccessCodeCard");
    expect(page).not.toContain("export default async function");
  });

  test("matches the authorization fallback width to the completed card", async () => {
    const page = await readWorkspaceFile("./page.tsx");

    const fallback = page.slice(
      page.indexOf("<Suspense"),
      page.indexOf("</Suspense>")
    );
    expect(fallback).toContain('className="max-w-3xl"');
    expect(page).toContain('className="max-w-3xl rounded-xl');
  });
});
