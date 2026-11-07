import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The app's server-bound import ban lives in the root biome.json. Workspace lint
// fixtures go in apps/deskohub-workspace/shared/testing/lint-rules.test.ts; this
// suite stays beside the app it guards.
const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const lintRoot = mkdtempSync(join(tmpdir(), "deskohub-mobile-import-ban-"));
const mobileDirectory = "apps/deskohub-mobile/import-ban";

// The cases sit at the repository's own relative paths under a copy of the root
// configuration, so its path-scoped overrides apply unchanged. Only the plugin
// paths are made absolute, and VCS is off because the copy is not a checkout.
const repositoryConfig = JSON.parse(
  readFileSync(join(repositoryRoot, "biome.json"), "utf8")
) as { readonly plugins: readonly string[] };
writeFileSync(
  join(lintRoot, "biome.json"),
  JSON.stringify({
    ...repositoryConfig,
    root: true,
    vcs: { enabled: false },
    plugins: repositoryConfig.plugins.map((plugin) =>
      join(repositoryRoot, plugin)
    ),
  })
);

const banned = "lint/style/noRestrictedImports";

// biome-ignore format: the case table stays one row per line on purpose.
const cases: readonly (readonly [title: string, source: string, flagged: boolean, directory?: string])[] = [
  ["rejects the @deskohub/next-effect root entry", 'import { runEffect } from "@deskohub/next-effect";\nexport { runEffect };\n', true],
  ["rejects a @deskohub/next-effect subpath", 'import { cached } from "@deskohub/next-effect/cached";\nexport { cached };\n', true],
  ["rejects a re-export from a @deskohub/next-effect subpath", 'export { effectAction } from "@deskohub/next-effect/effect-action";\n', true],
  ["rejects the @deskohub/i18n next entry", 'import { createLocaleMiddleware } from "@deskohub/i18n/next";\nexport { createLocaleMiddleware };\n', true],
  ["rejects a re-export from the @deskohub/i18n action entry", 'export { localeAction } from "@deskohub/i18n/action";\n', true],
  ["rejects the @deskohub/i18n request-locale entry", 'import { requestLocale } from "@deskohub/i18n/request-locale";\nexport { requestLocale };\n', true],
  ["rejects the next package", 'import next from "next";\nexport { next };\n', true],
  ["rejects next/navigation", 'import { useRouter } from "next/navigation";\nexport { useRouter };\n', true],
  ["rejects a re-export from next/server", 'export { NextResponse } from "next/server";\n', true],
  ["rejects a deep next subpath", 'import Link from "next/dist/client/link";\nexport { Link };\n', true],
  ["rejects a dynamic import of next/navigation", 'export const loadNavigation = () => import("next/navigation");\n', true],
  ["permits the @deskohub/i18n root entry", 'import { isLocale } from "@deskohub/i18n";\nexport { isLocale };\n', false],
  ["permits the @deskohub/i18n core entry", 'import { resolvePreferredLocale } from "@deskohub/i18n/core";\nexport { resolvePreferredLocale };\n', false],
  ["permits the @deskohub/i18n currency entry", 'import { formatCurrency } from "@deskohub/i18n/currency";\nexport { formatCurrency };\n', false],
  ["permits the @deskohub/i18n pathname entry", 'import { stripLocaleFromPathname } from "@deskohub/i18n/pathname";\nexport { stripLocaleFromPathname };\n', false],
  ["permits the @deskohub/i18n effect entry", 'import { createParaglideLocaleBridge } from "@deskohub/i18n/effect";\nexport { createParaglideLocaleBridge };\n', false],
  ["permits a re-export from the @deskohub/i18n translatable entry", 'export { translatable } from "@deskohub/i18n/translatable";\n', false],
  ["permits @deskohub/reservation", 'import { reservationDraft } from "@deskohub/reservation";\nexport { reservationDraft };\n', false],
  ["permits @deskohub/standard-schema", 'import { parseWithSchema } from "@deskohub/standard-schema";\nexport { parseWithSchema };\n', false],
  ["permits react-native", 'import { View } from "react-native";\nexport { View };\n', false],
  ["permits a package whose name only starts with next", 'import { ThemeProvider } from "next-themes";\nexport { ThemeProvider };\n', false],
  ["permits next/navigation outside the mobile app", 'import { useRouter } from "next/navigation";\nexport { useRouter };\n', false, "apps/deskohub-boardgame-bar/import-ban"],
];

const casePath = (index: number) =>
  `${cases[index]?.[3] ?? mobileDirectory}/case-${index}.ts`;

cases.forEach(([, source], index) => {
  const path = join(lintRoot, casePath(index));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source);
});

interface LintReport {
  readonly summary: { readonly changed: number; readonly unchanged: number };
  readonly diagnostics: readonly {
    readonly category: string;
    readonly location: { readonly path: string };
  }[];
}

let report: LintReport;

// One Biome run lints every case; each test reads its own file's diagnostics.
beforeAll(async () => {
  const biome = Bun.spawn(
    [
      join(repositoryRoot, "node_modules/.bin/biome"),
      "lint",
      "apps",
      "--reporter=json",
      "--max-diagnostics=none",
    ],
    { cwd: lintRoot, stdout: "pipe", stderr: "pipe" }
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(biome.stdout).text(),
    new Response(biome.stderr).text(),
    biome.exited,
  ]);
  if (exitCode !== 0 && exitCode !== 1) {
    throw new Error(`Biome exited with ${exitCode}: ${stderr}`);
  }
  report = JSON.parse(stdout) as LintReport;
});

afterAll(() => rmSync(lintRoot, { recursive: true, force: true }));

const categoriesOf = (path: string) =>
  report.diagnostics
    .filter(({ location }) => location.path === path)
    .map(({ category }) => category);

test("Biome lints every case file", () => {
  expect(report.summary.changed + report.summary.unchanged).toBe(cases.length);
});

cases.forEach(([title, , flagged], index) => {
  test(title, () => {
    expect(categoriesOf(casePath(index))).toEqual(flagged ? [banned] : []);
  });
});
