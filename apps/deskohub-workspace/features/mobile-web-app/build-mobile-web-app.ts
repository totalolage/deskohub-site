import { cp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { findMissingMobileWebAppFiles } from "./mobile-web-app-export.js";

const appRoot = resolve(import.meta.dir, "../..");

/**
 * Replaces `targetDirectory` with the mobile app's web export, so files a
 * previous export had and this one dropped don't linger.
 */
export const copyMobileWebApp = async ({
  exportDirectory,
  targetDirectory,
}: {
  exportDirectory: string;
  targetDirectory: string;
}) => {
  const missing = findMissingMobileWebAppFiles(exportDirectory);
  if (missing.length > 0) {
    throw new Error(
      `The mobile web export in ${exportDirectory} lacks ${missing.join(", ")}. Run \`bun turbo build:web --filter=deskohub-mobile\`.`
    );
  }
  await rm(targetDirectory, { recursive: true, force: true });
  await cp(exportDirectory, targetDirectory, { recursive: true });
};

if (import.meta.main) {
  await copyMobileWebApp({
    exportDirectory: resolve(appRoot, "../deskohub-mobile/dist"),
    targetDirectory: join(appRoot, "public/app"),
  });
}
