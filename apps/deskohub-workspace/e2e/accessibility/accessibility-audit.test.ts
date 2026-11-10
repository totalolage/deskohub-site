import { expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { supportedLocales } from "@deskohub/i18n/locale-registry";
import {
  ariaSnapshotLocales,
  auditedLocales,
  hasAriaSnapshots,
} from "./accessibility-audit";

const snapshotDirectories = [
  "checkout-pay-accessibility.pw.ts-snapshots",
  "workspace-aria-snapshots.pw.ts-snapshots",
];

test("audits every supported locale", () => {
  expect([...auditedLocales]).toEqual([...supportedLocales]);
});

test("matches ARIA snapshots only for the curated locales", () => {
  for (const locale of auditedLocales) {
    expect(hasAriaSnapshots(locale)).toBe(
      (ariaSnapshotLocales as readonly string[]).includes(locale)
    );
  }
});

test("commits ARIA snapshot files only for the curated locales", async () => {
  const files = (
    await Promise.all(
      snapshotDirectories.map((directory) =>
        readdir(join(import.meta.dir, directory))
      )
    )
  ).flat();
  const snapshotLocale = (file: string) =>
    auditedLocales.find((locale) => file.startsWith(`${locale}-`));

  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const locale = snapshotLocale(file);
    expect([file, locale !== undefined && hasAriaSnapshots(locale)]).toEqual([
      file,
      true,
    ]);
  }
});
