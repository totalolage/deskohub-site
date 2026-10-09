import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dir, "../..");
const cloudinaryServerModule = "@deskohub/cloudinary" + "/server";

const allowedServerImports = new Set([
  "app/api/webhooks/cloudinary/route.ts",
  "app/api/webhooks/cloudinary/route.test.ts",
  "features/account/backend/customer-avatar.service.ts",
  "features/gallery/backend/cloudinary.service.ts",
  "features/gallery/backend/get-cloudinary-images.server.ts",
]);

const gallerySearchModule =
  "features/gallery/backend/get-cloudinary-images.server.ts";
const gallerySearchModuleSpecifier =
  "@/features/gallery/backend/get-cloudinary-images.server";
const gallerySearchCallers = [
  "app/[locale]/(full-header)/gallery/page.tsx",
  "app/[locale]/(full-header)/meeting-room/page.tsx",
  "app/[locale]/(full-header)/ttrpg-room/page.tsx",
  "features/landing-page/components/landing-page-photo-carousel-section.tsx",
];
const customerAvatarService =
  "features/account/backend/customer-avatar.service.ts";

test("Cloudinary server reads stay behind cached workspace boundaries", async () => {
  const offenders: string[] = [];

  for (const filePath of await listSourceFiles(workspaceRoot)) {
    const contents = await readFile(filePath, "utf8");

    if (!contents.includes(cloudinaryServerModule)) continue;

    const relativePath = relative(workspaceRoot, filePath);
    if (!allowedServerImports.has(relativePath)) offenders.push(relativePath);
  }

  expect(offenders).toEqual([]);
});

test("gallery results are shared across server instances", async () => {
  // A per-instance cache refetches Cloudinary on every cold start; with the
  // former Search API lookup that exhausted the shared rate limit (HTTP 420)
  // during E2E reruns.
  const gallerySource = await readWorkspaceSource(gallerySearchModule);
  expect(gallerySource).toMatch(/(^|\n)\s*"use cache: remote";/);
});

test("gallery searches stay server-only and cannot enumerate avatar assets", async () => {
  const gallerySource = await readWorkspaceSource(gallerySearchModule);
  expect(gallerySource).toContain('import "server-only";');
  expect(gallerySource).not.toMatch(/(^|\n)\s*["']use server["'];?/);

  const galleryCallers: string[] = [];
  const galleryProviderCalls: string[] = [];
  const avatarStagingListings: string[] = [];
  const broadSearches: string[] = [];

  for (const filePath of await listSourceFiles(workspaceRoot)) {
    const relativePath = relative(workspaceRoot, filePath);
    if (
      relativePath.endsWith(".test.ts") ||
      relativePath.endsWith(".test.tsx")
    ) {
      continue;
    }

    const contents = await readFile(filePath, "utf8");
    if (contents.includes(gallerySearchModuleSpecifier)) {
      galleryCallers.push(relativePath);
      expect(contents).not.toMatch(/(^|\n)\s*["']use client["'];?/);
      expect(contents).not.toMatch(/(^|\n)\s*["']use server["'];?/);
    }
    if (/\bgetGalleryImages\s*\(/.test(contents)) {
      galleryProviderCalls.push(relativePath);
    }
    if (/\blistFolderAssets\s*\(/.test(contents)) {
      avatarStagingListings.push(relativePath);
    }
    if (
      /\.(?:searchAll|searchByExpression|searchByFolder|listTaggedAssets)\s*\(/.test(
        contents
      )
    ) {
      broadSearches.push(relativePath);
    }
  }

  expect(galleryCallers.sort()).toEqual(gallerySearchCallers);
  expect(galleryProviderCalls).toEqual([gallerySearchModule]);
  expect(avatarStagingListings).toEqual([customerAvatarService]);
  expect(broadSearches).toEqual([]);

  const avatarSource = await readWorkspaceSource(customerAvatarService);
  expect(avatarSource).toContain('import "server-only";');
  expect(avatarSource).toContain("accountStagingFolder(namespace, accountId)");
});

async function readWorkspaceSource(relativePath: string): Promise<string> {
  return readFile(resolve(workspaceRoot, relativePath), "utf8");
}

async function listSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.flatMap((entry) => {
      if (entry.name === "node_modules" || entry.name === ".next") return [];

      const path = resolve(directory, entry.name);

      if (entry.isDirectory()) return listSourceFiles(path);
      if ([".ts", ".tsx"].includes(extname(entry.name))) return [path];

      return [];
    })
  );

  return files.flat();
}
