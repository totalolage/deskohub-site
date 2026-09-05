import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const fixtureRoot = mkdtempSync(join(tmpdir(), "deskohub-lint-rules-"));
const decoder = new TextDecoder();

writeFileSync(
  join(fixtureRoot, "biome.json"),
  JSON.stringify({
    linter: { enabled: true },
    plugins: [join(repositoryRoot, "lint", "no-wildcard-reexport.grit")],
  })
);

const lintModule = (module: string, source: string) => {
  const path = join(fixtureRoot, module);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source);

  return Bun.spawnSync({
    cmd: [
      "bunx",
      "biome",
      "lint",
      path,
      "--config-path",
      join(fixtureRoot, "biome.json"),
      "--max-diagnostics=none",
    ],
    cwd: repositoryRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
};

const cases = [
  {
    behavior: "rejects a wildcard value re-export",
    module: "apps/deskohub-workspace/features/reservations/index.ts",
    source: 'export * from "./reservation";\n',
    flagged: true,
  },
  {
    behavior: "rejects a wildcard type re-export",
    module: "apps/deskohub-workspace/features/reservations/index.ts",
    source: 'export type * from "./reservation-types";\n',
    flagged: true,
  },
  {
    behavior: "permits an explicit namespace re-export",
    module: "apps/deskohub-workspace/features/reservations/index.ts",
    source: 'export * as Reservations from "./reservations";\n',
    flagged: false,
  },
  {
    behavior: "permits an explicit type namespace re-export",
    module: "apps/deskohub-workspace/features/reservations/index.ts",
    source: 'export type * as ReservationTypes from "./reservation-types";\n',
    flagged: false,
  },
  {
    behavior: "permits a named re-export",
    module: "apps/deskohub-workspace/features/reservations/index.ts",
    source: 'export { reserveSeat, cancelReservation } from "./reservation";\n',
    flagged: false,
  },
  {
    behavior: "permits an ordinary import",
    module: "apps/deskohub-workspace/features/reservations/book-seat.ts",
    source: 'import { reserveSeat } from "./reservation";\n',
    flagged: false,
  },
  {
    behavior: "permits a namespace import",
    module: "apps/deskohub-workspace/features/reservations/book-seat.ts",
    source: 'import * as reservations from "./reservations";\n',
    flagged: false,
  },
  {
    behavior: "permits a test module",
    module: "apps/deskohub-workspace/features/reservations/index.test.ts",
    source: 'export * from "./reservation-fixtures";\n',
    flagged: false,
  },
  {
    behavior: "permits a generated module",
    module:
      "apps/deskohub-workspace/shared/backend/generated/dotypos-client.ts",
    source: 'export * from "./dotypos-types";\n',
    flagged: false,
  },
  {
    behavior: "permits a module outside the Workspace app",
    module: "apps/dhw/src/barrel.ts",
    source: 'export * from "./catalog";\n',
    flagged: false,
  },
] as const;

for (const { behavior, module, source, flagged } of cases) {
  test(`no-wildcard-reexport ${behavior}`, () => {
    const result = lintModule(module, source);
    const output = `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`;

    expect(output.includes("re-exports must be explicit")).toBe(flagged);
    expect(result.exitCode).toBe(flagged ? 1 : 0);
  });
}

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});
