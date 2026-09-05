import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const fixtureRoot = mkdtempSync(join(tmpdir(), "deskohub-lint-rules-"));
const decoder = new TextDecoder();
const config = join(fixtureRoot, "biome.json");
const unlimited = "--max-diagnostics=none";

// biome-ignore format: compact configuration literal.
writeFileSync(config, JSON.stringify({
  linter: { enabled: true },
  plugins: [
    join(repositoryRoot, "lint", "no-wildcard-reexport.grit"),
    join(repositoryRoot, "lint", "prefer-effect-fn.grit"),
  ],
}));

const lintModule = (module: string, source: string) => {
  const path = join(fixtureRoot, module);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source);
  const args = ["lint", path, "--config-path", config, unlimited];
  return Bun.spawnSync({
    cmd: ["bunx", "biome", ...args],
    cwd: repositoryRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
};

type Row = readonly [string, string, boolean, string?];

const gen =
  "(input: string) => Effect.gen(function* () { return yield* Effect.succeed(input); })";
const piped =
  '() => Effect.gen(function* () { return yield* Effect.succeed("seat-1"); }).pipe(Effect.andThen((value) => value))';
const multiPiped =
  '() => Effect.gen(function* () { return yield* Effect.succeed("seat-1"); }).pipe(Effect.tap(() => Effect.void), Effect.andThen((value) => value))';
const transform =
  ", (effect) => effect.pipe(Effect.catchAll(() => Effect.succeed(null)))";
const twoTransforms = `${transform}, (e) => e.pipe(Effect.map((v) => v))`;
const threeTransforms = `${twoTransforms}, (e) => e.pipe(Effect.tap(() => Effect.void))`;
const traced = (callback: string, extra = "") =>
  `export const loadReservation = Effect.fn("ReservationService.loadReservation")(${callback}${extra});\n`;
const untracedGen =
  "export const loadAnalytics = (input: string) => Effect.gen(function* () { return yield* Effect.succeed(input); });\n";
const arrowGen = (body: string) => `export const probe = ${body}\n`;
const applyDiscountCodeOriginal = `export const applyDiscountCodeToPayState = Effect.fn(
  "checkout.applyDiscountCodeToPayState"
)(
  ${gen},
  (effect) => effect.pipe(Effect.catchTags({ PromotionCodeUnavailableError: () => Effect.succeed("unavailable") }))
);
`;

const reservations = "apps/deskohub-workspace/features/reservations";
const booking = `${reservations}/book-seat.ts`;
const generated =
  "apps/deskohub-workspace/shared/backend/generated/dotypos-client.ts";

// biome-ignore format: the case table stays one row per line on purpose.
const rules: { name: string; diagnostic: string; module: string; cases: Row[] }[] = [
  {
    name: "no-wildcard-reexport", diagnostic: "re-exports must be explicit",
    module: `${reservations}/index.ts`,
    cases: [
      ["rejects value wildcards", 'export * from "./reservation";\n', true],
      ["rejects type wildcards", 'export type * from "./reservation-types";\n', true],
      ["permits explicit namespaces", 'export * as Reservations from "./reservations";\n', false],
      ["permits explicit type namespaces", 'export type * as ReservationTypes from "./reservation-types";\n', false],
      ["permits named re-exports", 'export { reserveSeat, cancelReservation } from "./reservation";\n', false],
      ["permits ordinary imports", 'import { reserveSeat } from "./reservation";\n', false, booking],
      ["permits namespace imports", 'import * as reservations from "./reservations";\n', false, booking],
      ["permits test modules", 'export * from "./reservation-fixtures";\n', false, `${reservations}/index.test.ts`],
      ["permits generated modules", 'export * from "./dotypos-types";\n', false, generated],
      ["permits modules outside Workspace", 'export * from "./catalog";\n', false, "apps/dhw/src/barrel.ts"],
    ],
  },
  {
    name: "prefer-effect-fn", diagnostic: "declare the generator function directly",
    module: "apps/deskohub-workspace/features/reservation/load-reservation.ts",
    cases: [
      ["rejects a traced direct generator", traced(gen), true],
      ["rejects a traced piped generator", traced(piped), true],
      ["rejects generators piped to multiple operators", traced(multiPiped), true],
      ["rejects piped generators with a trailing transform", traced(piped, transform), true],
      ["rejects a generator with two trailing transforms", traced(piped, twoTransforms), true],
      ["rejects a generator with three trailing transforms", traced(gen, threeTransforms), true],
      ["rejects the original apply-discount-code wrapper", applyDiscountCodeOriginal, true],
      ["permits the canonical generator callback", traced("function* (input: string) { return yield* Effect.succeed(input); }"), false],
      ["permits the canonical callback with many transforms", traced("function* (input: string) { return yield* Effect.succeed(input); }", threeTransforms), false],
      ["permits a non-generator Effect callback", arrowGen('Effect.fn("WorkspaceFeatureFlagService.isEnabled")((key: string) => Effect.succeed(key).pipe(Effect.andThen((value) => value)));'), false],
      ["permits an untraced generator arrow", untracedGen, false],
      ["permits an async server bridge", 'export const bridgeReservation = async (input: string) => { "use server"; return Effect.runPromise(Effect.succeed(input)); };\n', false],
    ],
  },
  {
    name: "prefer-effect-fn-analytics", diagnostic: "Define Effect generator functions with Effect.fn",
    module: "apps/deskohub-workspace/features/checkout/backend/analytics/publish-analytics.ts",
    cases: [["retains the bare arrow restriction", untracedGen, true]],
  },
];

for (const { name, diagnostic, module, cases } of rules) {
  for (const [behavior, source, flagged, override] of cases) {
    test(`${name} ${behavior}`, () => {
      const result = lintModule(override ?? module, source);
      const output = `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`;
      expect(output.includes(diagnostic)).toBe(flagged);
      expect(result.exitCode).toBe(flagged ? 1 : 0);
    });
  }
}

afterAll(() => rmSync(fixtureRoot, { recursive: true, force: true }));
