import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Files of the mobile app's web export that the installable app at `/app/`
 * can't work without: the single-page shell, its manifest, its service worker
 * and the worker's offline page.
 */
export const mobileWebAppEntryFiles = [
  "index.html",
  "manifest.webmanifest",
  "sw.js",
  "offline.html",
];

/** @param {string} directory */
export const findMissingMobileWebAppFiles = (directory) =>
  mobileWebAppEntryFiles.filter((file) => !existsSync(join(directory, file)));

/**
 * Fails a production build that would deploy without `/app/`. Turbo's
 * `build` copies the export into `public/app` before `next build` runs.
 *
 * @param {string} publicAppDirectory
 */
export const assertMobileWebAppExported = (publicAppDirectory) => {
  const missing = findMissingMobileWebAppFiles(publicAppDirectory);
  if (missing.length === 0) return;
  throw new Error(
    `The mobile web app export is missing from ${publicAppDirectory} (${missing.join(", ")}). Build the Workspace with \`bun turbo build\`, or run \`bun turbo mobile-web-app:build\` before \`next build\`.`
  );
};
