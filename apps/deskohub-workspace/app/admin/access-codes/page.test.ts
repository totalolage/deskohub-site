import { describe, expect, test } from "bun:test";
import {
  countOccurrences,
  extractImportSpecifiers,
  readTrackedSource,
  sliceBetween,
} from "@/scripts/shared/source-contract";

const readWorkspaceFile = (path: string) =>
  readTrackedSource(new URL(path, import.meta.url).pathname);

describe("access codes admin route boundary", () => {
  test("renders the form through the cached administration page boundary", () => {
    const page = readWorkspaceFile("./page.tsx");

    expect(countOccurrences(page, "await authorizeAdministratorPage()")).toBe(
      1
    );
    expect(page.includes("<Suspense")).toBe(true);
    const imports = extractImportSpecifiers(page).join("\n");
    expect(imports.includes("requireDiscountAdminAuthorization")).toBe(false);
    expect(imports.includes("basic-auth")).toBe(false);
    expect(imports.includes("ADMIN_BASIC_AUTH_SHA256")).toBe(false);
  });

  test("keeps the streamed card in the local suspense boundary", () => {
    const page = readWorkspaceFile("./page.tsx");

    expect(page.includes("AuthorizedAccessCodeCard")).toBe(true);
    expect(page.includes("export default async function")).toBe(false);
  });

  test("matches the authorization fallback width to the completed card", () => {
    const page = readWorkspaceFile("./page.tsx");

    const fallback = sliceBetween(page, "<Suspense", "</Suspense>");
    expect(fallback.includes('className="max-w-3xl"')).toBe(true);
    expect(page.includes('className="max-w-3xl rounded-xl')).toBe(true);
  });
});
