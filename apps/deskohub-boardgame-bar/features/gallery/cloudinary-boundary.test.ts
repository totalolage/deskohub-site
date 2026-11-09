import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

const appRoot = resolve(import.meta.dir, "../..");
const searchModule = "features/gallery/backend/get-cloudinary-images.server.ts";
const searchSpecifier =
  "@/features/gallery/backend/get-cloudinary-images.server";
const lookupModule =
  "features/gallery/backend/get-cloudinary-image-by-public-id.server.ts";
const lookupSpecifier =
  "@/features/gallery/backend/get-cloudinary-image-by-public-id.server";

// Uncached Cloudinary Admin API calls spend the quota shared with E2E runs.
test("Cloudinary Admin API calls stay inside the cached gallery queries", async () => {
  const providerSearches: string[] = [];
  const providerLookups: string[] = [];

  for (const filePath of await listSourceFiles(appRoot)) {
    const relativePath = relative(appRoot, filePath);
    if (
      relativePath.endsWith(".test.ts") ||
      relativePath.endsWith(".test.tsx")
    ) {
      continue;
    }

    const contents = await readFile(filePath, "utf8");
    if (
      contents.includes(searchSpecifier) ||
      contents.includes(lookupSpecifier)
    ) {
      expect(contents).not.toMatch(/(^|\n)\s*["']use client["'];?/);
      expect(contents).not.toMatch(/(^|\n)\s*["']use server["'];?/);
    }
    if (/\bgetGalleryImages\s*\(/.test(contents)) {
      providerSearches.push(relativePath);
    }
    if (/\bgetByPublicId\s*\(/.test(contents)) {
      providerLookups.push(relativePath);
    }
  }

  expect(providerSearches).toEqual([searchModule]);
  expect(providerLookups).toEqual([lookupModule]);
});

async function listSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;

    const path = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listSourceFiles(path)));
    } else if ([".ts", ".tsx"].includes(extname(entry.name))) {
      files.push(path);
    }
  }

  return files;
}
