import { expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "./shared/command";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));

const lint = async (
  source: string,
  workspaceDirectory = "scripts",
  filename = "probe.ts"
) => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "deskohub-anti-slop-"));
  const directory = join(
    temporaryRoot,
    "apps/deskohub-workspace",
    workspaceDirectory
  );
  mkdirSync(directory, { recursive: true });
  const path = join(directory, filename);
  writeFileSync(path, source);

  try {
    return await runCommand(
      [
        "bunx",
        "biome",
        "lint",
        path,
        "--config-path",
        "biome.json",
        "--vcs-root",
        ".",
        "--max-diagnostics=none",
      ],
      { cwd: repositoryRoot }
    );
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
};

test("anti-slop allows independent assertions and parsed unknown values", async () => {
  const result = await lint(`
declare const input: unknown;
declare function parse(value: string): number;
const result = parse(input as string) as number;
const parenthesizedResult = (parse(input as string)) as number;
const payload: unknown = JSON.parse("{}");
void result;
void parenthesizedResult;
void payload;
`);

  expect(result.exitCode).toBe(0);
});

test("unknown parameter rule allows error causes", async () => {
  const result = await lint(`
const handleFailure = (cause: unknown) => String(cause);
void handleFailure;
`);
  const output = `${result.stdout}${result.stderr}`;

  expect(output).not.toContain("[anti-slop/no-unknown-parameters]");
});

test("anti-slop reports all eleven rules", async () => {
  const result = await lint(`
declare const externalValue: unknown;
const chained = externalValue as unknown as { value: string };
const conditionalSpread = { ...(true ? { value: 1 } : {}) };
const widened: unknown = { value: 1 };
const objectParameter = (_value: object) => undefined;
declare function operationOn(value: { id: string }): string;
declare const repeatedConditionalOperands: readonly ({ id: string } | undefined)[];
const repeatedConditional = repeatedConditionalOperands[0]
  ? operationOn(repeatedConditionalOperands[0])
  : null;
const runtimeType = typeof externalValue;
const payloadShape = 1;
const unknownParameter = (_value: unknown) => undefined;
type HiddenUnknown = unknown;
type UnsafeDictionary = Record<string, unknown>;
const reconstruct = () => {
  const evidence: unknown = { value: 1 };
  return evidence as { value: number };
};
void chained;
void conditionalSpread;
void widened;
void objectParameter;
void repeatedConditional;
void runtimeType;
void payloadShape;
void unknownParameter;
void reconstruct;
`);
  const output = `${result.stdout}${result.stderr}`;

  for (const rule of [
    "no-chained-type-assertions",
    "no-conditional-empty-object-spread",
    "no-known-value-widening",
    "no-object-parameters",
    "no-repeated-computed-conditional-operand",
    "no-runtime-typeof",
    "no-shape-in-symbol-names",
    "no-unknown-parameters",
    "no-unknown-type-aliases",
    "no-unsafe-dictionary-type",
    "no-widen-then-assert",
  ]) {
    expect(output).toContain(`[anti-slop/${rule}]`);
  }
});

test("repeated computed conditional operand rule allows independent branches", async () => {
  const result = await lint(`
declare const condition: boolean;
declare function loadValue(): string;
const value = condition ? loadValue() : null;
void value;
`);
  const output = `${result.stdout}${result.stderr}`;

  expect(output).not.toContain(
    "[anti-slop/no-repeated-computed-conditional-operand]"
  );
});

test("repeated computed conditional operand rule preserves falsey semantics", async () => {
  const result = await lint(`
declare const values: readonly (number | undefined)[];
const value = values[0] ? values[0] : null;
void value;
`);
  const output = `${result.stdout}${result.stderr}`;

  expect(output).toContain(
    "[anti-slop/no-repeated-computed-conditional-operand]"
  );
  expect(output).not.toContain("logical AND");
});

test("chained assertion rule retains Workspace e2e coverage", async () => {
  const result = await lint(
    "declare const value: unknown; value as unknown as string;",
    "e2e"
  );
  const output = `${result.stdout}${result.stderr}`;

  expect(output).toContain("[anti-slop/no-chained-type-assertions]");
});

test("shape rule ignores external property names", async () => {
  const result = await lint(
    `
declare function configure(value: { defaultValidationErrorsShape: string }): void;
configure({ defaultValidationErrorsShape: "flattened" });
const view = <Map tableShapeInlineStyle={() => ({})} />;
void view;
`,
    "scripts",
    "probe.tsx"
  );
  const output = `${result.stdout}${result.stderr}`;

  expect(output).not.toContain("[anti-slop/no-shape-in-symbol-names]");
});

test("chained assertion rule unwraps nested parentheses", async () => {
  const result = await lint(`
declare const value: unknown;
const asserted = ((value as unknown)) as string;
void asserted;
`);
  const output = `${result.stdout}${result.stderr}`;

  expect(output).toContain("[anti-slop/no-chained-type-assertions]");
});

test("conditional spread rule reports objects with sibling properties", async () => {
  const result = await lint(`
declare const condition: boolean;
const payload = { fixed: 1, ...(condition ? { value: 1 } : {}) };
void payload;
`);
  const output = `${result.stdout}${result.stderr}`;

  expect(output).toContain("[anti-slop/no-conditional-empty-object-spread]");
});

test("conditional spread rule ignores conditionals inside spread calls", async () => {
  const result = await lint(`
declare const condition: boolean;
declare function normalize(value: { value?: number }): object;
const payload = { ...normalize(condition ? { value: 1 } : {}) };
void payload;
`);
  const output = `${result.stdout}${result.stderr}`;

  expect(output).not.toContain(
    "[anti-slop/no-conditional-empty-object-spread]"
  );
});

test("known value widening allows empty dictionary accumulators", async () => {
  const result = await lint(`
const handlers: Record<string, string> = {};
handlers.start = "ready";
`);
  const output = `${result.stdout}${result.stderr}`;

  expect(output).not.toContain("[anti-slop/no-known-value-widening]");
});

test("known value widening reports nested Record value types", async () => {
  const result = await lint(`
const handlers: Record<string, () => void> = { start: () => undefined };
void handlers;
`);
  const output = `${result.stdout}${result.stderr}`;

  expect(output).toContain("[anti-slop/no-known-value-widening]");
});

test("widen-then-assert does not connect unrelated scopes", async () => {
  const result = await lint(`
function first() {
  const value: unknown = { ok: true };
  return value;
}
function second(value: string | number) {
  return value as string;
}
function third() {
  const value: unknown = { ok: true };
  {
    const value: string | number = "known";
    return value as string;
  }
}
function fourth(value: string | number) {
  function inner() {
    const value: unknown = { ok: true };
    return value;
  }
  void inner;
  return value as string;
}
void first;
void second;
void third;
void fourth;
`);
  const output = `${result.stdout}${result.stderr}`;

  expect(output).not.toContain("[anti-slop/no-widen-then-assert]");
});

test("widen-then-assert reports a direct top-level binding", async () => {
  const result = await lint(`
const evidence: unknown = { value: 1 };
const reconstructed = evidence as { value: number };
void reconstructed;
`);
  const output = `${result.stdout}${result.stderr}`;

  expect(output).toContain("[anti-slop/no-widen-then-assert]");
});

test("widen-then-assert reports an outer binding despite nested shadowing", async () => {
  const result = await lint(`
function reconstruct(condition: boolean) {
  const value: unknown = { ok: true };
  if (condition) {
    const value = "shadow";
    void value;
  }
  return value as { ok: boolean };
}
void reconstruct;
`);
  const output = `${result.stdout}${result.stderr}`;

  expect(output).toContain("[anti-slop/no-widen-then-assert]");
});

test("unsafe dictionary allows concrete values containing unknown", async () => {
  const result = await lint(`
type AsyncValues = Record<string, Promise<unknown>>;
type AsyncUnionValues = Record<string, Promise<unknown | null>>;
type StructuredValues = Record<string, { value: unknown; source: string }>;
type NestedValues = { [key: string]: Promise<unknown> };
void (0 as unknown as AsyncValues);
void (0 as unknown as AsyncUnionValues);
void (0 as unknown as StructuredValues);
void (0 as unknown as NestedValues);
`);
  const output = `${result.stdout}${result.stderr}`;

  expect(output).not.toContain("[anti-slop/no-unsafe-dictionary-type]");
});

test("unsafe dictionary reports direct unsafe union members", async () => {
  const result = await lint(`
type RecordValues = Record<string, unknown | undefined>;
type IndexedValues = { [key: string]: null | object };
void (0 as unknown as RecordValues);
void (0 as unknown as IndexedValues);
`);
  const output = `${result.stdout}${result.stderr}`;

  expect(output).toContain("[anti-slop/no-unsafe-dictionary-type]");
});

test("useless alias rule reports const aliases of bindings that cannot be reassigned", async () => {
  const result = await lint(`
import { workspaceCoworkTiers } from "./tiers";
import formatPrice from "./format";
import * as Schema from "./schema";
const defaultCapacity = 4;
const { region } = { region: "eu" };
function loadTier() {
  return workspaceCoworkTiers;
}
class TierRepository {}
declare const items: readonly string[];
export const workspaceCoworkProductTiers = workspaceCoworkTiers;
const priceFormatter = formatPrice;
const Contract = Schema;
const capacity = defaultCapacity;
const deploymentRegion = region;
const loadProductTier = loadTier;
const Repository = TierRepository;
for (const item of items) {
  const entry = item;
  void entry;
}
void priceFormatter;
void Contract;
void capacity;
void deploymentRegion;
void loadProductTier;
void Repository;
`);
  const output = `${result.stdout}${result.stderr}`;

  expect(output.split("[anti-slop/no-useless-alias]").length - 1).toBe(8);
});

test("useless alias rule tells identical alias declarations in nested scopes apart", async () => {
  const result = await lint(`
const closingHour = 18;
const savedClosingHour = closingHour;
export function readClosingHour() {
  const closingHour = 20;
  const before = () => savedClosingHour;
  {
    const savedClosingHour = closingHour;
    void savedClosingHour;
  }
  return [before(), closingHour];
}
`);
  const output = `${result.stdout}${result.stderr}`;

  expect(output.split("[anti-slop/no-useless-alias]").length - 1).toBe(1);
  expect(output).toContain("probe.ts:8:5");
});

test("useless alias rule allows snapshots, parameters, destructuring, shadowed sources, symbol aliases, and annotated aliases", async () => {
  const result = await lint(`
import { workspaceCoworkTiers } from "./tiers";
const openingHour = 8;
const savedOpeningHour = openingHour;
function readOpeningHour() {
  // Substituting openingHour here would read the inner binding in its TDZ.
  const previous = [savedOpeningHour];
  const openingHour = 9;
  return [...previous, openingHour];
}
const deskCount = 4;
const savedDeskCount = deskCount;
const DeskCounter = class deskCount {
  value = savedDeskCount;
};
const roomCount = 2;
const savedRoomCount = roomCount;
const countRooms = function roomCount() {
  return savedRoomCount;
};
const seatCount = 6;
const savedSeatCount = seatCount;
enum SeatCounts {
  seatCount = 8,
  saved = savedSeatCount,
}
const floorCount = 3;
const savedFloorCount = floorCount;
const wingCount = 2;
const savedWingCount = wingCount;
enum QuotedWings {
  "wingCount" = 4,
  saved = savedWingCount,
}
const $gateCount = 1;
const savedGateCount = $gateCount;
enum DollarGates {
  $gateCount = 3,
  saved = savedGateCount,
}
const doorCount = 2;
const savedDoorCount = doorCount;
enum CommentedDoors {
  doorCount /* shadows */ = 4,
  saved = savedDoorCount,
}
const roofCount = 1;
const savedRoofCount = roofCount;
enum CommentedRoofs {
  // shadows
  roofCount // too
    = 5,
  saved = savedRoofCount,
}
const hallCount = 3;
const savedHallCount = hallCount;
enum BracketedHalls {
  [ /* shadows */ "hallCount" ] = 6,
  saved = savedHallCount,
}
const stairCount = 2;
const savedStairCount = stairCount;
enum TemplateStairs {
  [\`stairCount\`] = 4,
  saved = savedStairCount,
}
const crestKey = Symbol /* c */ ();
const savedCrestKey = crestKey;
import { ticketKey } from "./keys";
const savedTicketKey = ticketKey;
type TicketKey = typeof /* c */ savedTicketKey;
const badgeKey = Symbol("badge");
const savedBadgeKey = badgeKey;
import { sessionKey } from "./keys";
const savedSessionKey = sessionKey;
type SessionKey = typeof savedSessionKey;
namespace Floors {
  const floorCount = 5;
  export const counts = [savedFloorCount, floorCount];
}
let attempt = 0;
const previousAttempt = attempt;
attempt += 1;
var legacyCounter = 0;
const legacySnapshot = legacyCounter;
const normalize = (value: string, ...rest: string[]) => {
  const original = value;
  const remaining = rest;
  return [original, ...remaining];
};
const identity = (input: string) => {
  const kept = input;
  return kept;
};
const bareArrow = (raw) => {
  const kept = raw;
  return kept;
};
const unwrap = ({ nested }: { nested: string }) => {
  const kept = nested;
  return kept;
};
class Service {
  constructor(private readonly client: string) {
    const kept = client;
    void kept;
  }
}
try {
  void 0;
} catch (cause) {
  const failure = cause;
  void failure;
}
const { tiers } = { tiers: workspaceCoworkTiers };
const annotatedTiers: readonly string[] = workspaceCoworkTiers;
const firstTier = workspaceCoworkTiers[0];
const undefinedValue = undefined;
const global = globalThis;
void readOpeningHour;
void DeskCounter;
void countRooms;
void SeatCounts;
void QuotedWings;
void DollarGates;
void CommentedDoors;
void CommentedRoofs;
void BracketedHalls;
void TemplateStairs;
void savedCrestKey;
const ticketKeyProbe: TicketKey = ticketKey;
void ticketKeyProbe;
void savedBadgeKey;
const sessionKeyProbe: SessionKey = sessionKey;
void sessionKeyProbe;
void Floors;
void previousAttempt;
void legacySnapshot;
void normalize;
void identity;
void bareArrow;
void unwrap;
void Service;
void tiers;
void annotatedTiers;
void firstTier;
void undefinedValue;
void global;
`);
  const output = `${result.stdout}${result.stderr}`;

  expect(output).not.toContain("[anti-slop/no-useless-alias]");
});

test("useless alias rule skips files whose enum member names use escapes", async () => {
  const result = await lint(`
const laneCount = 6;
const savedLaneCount = laneCount;
enum EscapedLanes {
  "\\u006caneCount" = 7,
  saved = savedLaneCount,
}
void EscapedLanes;
`);
  const output = `${result.stdout}${result.stderr}`;

  expect(output).not.toContain("[anti-slop/no-useless-alias]");
});

test("useless alias rule treats let and var declarations without whitespace as reassignable", async () => {
  const result = await lint(`
let{ pierCount } = { pierCount: 1 };
const savedPierCount = pierCount;
pierCount = 2;
let/* snapshot */ dockCount = 1;
const savedDockCount = dockCount;
dockCount = 2;
for (var/* loop */ quayCount = 0; quayCount < 1; quayCount++) {
  void quayCount;
}
const savedQuayCount = quayCount;
void [savedPierCount, savedDockCount, savedQuayCount];
`);
  const output = `${result.stdout}${result.stderr}`;

  expect(output).not.toContain("[anti-slop/no-useless-alias]");
});

test("every workspace shared package dependency defines a lint task", () => {
  const workspaceManifest = JSON.parse(
    readFileSync(
      join(repositoryRoot, "apps/deskohub-workspace/package.json"),
      "utf8"
    )
  );
  const dependencyNames = Object.entries({
    ...workspaceManifest.dependencies,
    ...workspaceManifest.devDependencies,
  })
    .filter(([, version]) => version === "workspace:*")
    .map(([name]) => name);

  expect(dependencyNames.length).toBeGreaterThan(0);

  const rootManifest = JSON.parse(
    readFileSync(join(repositoryRoot, "package.json"), "utf8")
  );
  const workspaceDirectories = (rootManifest.workspaces as string[]).flatMap(
    (pattern) =>
      pattern.endsWith("/*")
        ? readdirSync(join(repositoryRoot, pattern.slice(0, -2)), {
            withFileTypes: true,
          })
            .filter((entry) => entry.isDirectory())
            .map((entry) => join(pattern.slice(0, -2), entry.name))
        : [pattern]
  );
  const lintTasks = new Map(
    workspaceDirectories.map((directory) => {
      const manifest = JSON.parse(
        readFileSync(join(repositoryRoot, directory, "package.json"), "utf8")
      );
      return [
        manifest.name as string,
        manifest.scripts?.lint as string | undefined,
      ];
    })
  );

  const packagesWithoutLint = dependencyNames.filter((name) => {
    const lintTask = lintTasks.get(name);

    return lintTask === undefined || lintTask.trim() === "";
  });

  expect(packagesWithoutLint).toEqual([]);
});

test("Workspace lint is a Turbo dependency graph", () => {
  const readJson = (path: string) =>
    JSON.parse(readFileSync(join(repositoryRoot, path), "utf8"));
  const rootTurbo = readJson("turbo.json");
  const workspaceManifest = readJson("apps/deskohub-workspace/package.json");
  const workspaceTurbo = readJson("apps/deskohub-workspace/turbo.json");

  const lintTasks = ["lint:biome", "lint:eslint", "lint:knip"];

  expect(workspaceManifest.scripts?.lint).toBeUndefined();
  for (const task of lintTasks) {
    expect(workspaceManifest.scripts?.[task]?.trim()).toBeTruthy();
  }
  expect(workspaceTurbo.tasks?.lint?.dependsOn).toEqual(
    expect.arrayContaining(["$TURBO_EXTENDS$", ...lintTasks])
  );
  expect(rootTurbo.tasks?.lint?.dependsOn).toContain("^lint");
});
