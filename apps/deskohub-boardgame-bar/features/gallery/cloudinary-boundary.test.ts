import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

const appRoot = resolve(import.meta.dir, "../..");
const searchModule = "features/gallery/backend/get-cloudinary-images.server.ts";
const searchSpecifier =
  "@/features/gallery/backend/get-cloudinary-images.server";
const expectedCallers = [
  "app/[locale]/gallery/page.tsx",
  "app/[locale]/training-room/gallery/page.tsx",
  "features/home/components/about-section.tsx",
  "shared/components/hero.tsx",
];

test("Cloudinary gallery searches stay inside a server-only query", async () => {
  const searchSource = await readAppSource(searchModule);
  expect(searchSource).toContain('import "server-only";');
  expect(searchSource).not.toMatch(/(^|\n)\s*["']use server["'];?/);
  expect(searchSource).toContain('"use cache";');
  expect(searchSource).toMatch(
    /applyCacheTags\(\s*cloudinaryTags\.all\(\),\s*cloudinaryTags\.search\(tags,\s*maxResults\)\s*\)/
  );

  const callers: string[] = [];
  const providerSearches: string[] = [];

  for (const filePath of await listSourceFiles(appRoot)) {
    const relativePath = relative(appRoot, filePath);
    if (
      relativePath.endsWith(".test.ts") ||
      relativePath.endsWith(".test.tsx")
    ) {
      continue;
    }

    const contents = await readFile(filePath, "utf8");
    if (contents.includes(searchSpecifier)) {
      callers.push(relativePath);
      expect(contents).not.toMatch(/(^|\n)\s*["']use client["'];?/);
      expect(contents).not.toMatch(/(^|\n)\s*["']use server["'];?/);
    }
    if (/\bgetGalleryImages\s*\(/.test(contents)) {
      providerSearches.push(relativePath);
    }
  }

  expect(callers.sort()).toEqual(expectedCallers);
  expect(providerSearches).toEqual([searchModule]);
});

async function readAppSource(relativePath: string): Promise<string> {
  return readFile(resolve(appRoot, relativePath), "utf8");
}

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
