import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");
const { locales } = JSON.parse(
  readFileSync(join(appDirectory, "project.inlang/settings.json"), "utf8")
);

export const localeRedirectPattern = locales
  .map((locale) => locale.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");
