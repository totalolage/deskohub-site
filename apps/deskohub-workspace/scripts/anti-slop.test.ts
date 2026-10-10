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

test("chained assertion rule retains the E2E run plan", async () => {
  const result = await lint(
    "declare const value: object; value as unknown as { id: string };",
    "e2e/playwright-checkout",
    "run-plan.ts"
  );
  const output = `${result.stdout}${result.stderr}`;

  expect(output).toContain("[anti-slop/no-chained-type-assertions]");
});

test("chained assertion rule retains test utility coverage", async () => {
  const result = await lint(
    "declare const value: object; value as unknown as { id: string };",
    "shared/testing",
    "fixture.test-utils.ts"
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

  const lintTasks = new Map(
    readdirSync(join(repositoryRoot, "packages"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const manifest = JSON.parse(
          readFileSync(
            join(repositoryRoot, "packages", entry.name, "package.json"),
            "utf8"
          )
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

  expect(workspaceManifest.scripts?.lint).toBeUndefined();
  for (const [script, tool] of Object.entries({
    "lint:biome": "biome",
    "lint:eslint": "eslint",
    "lint:dependencies": "knip",
  })) {
    expect(workspaceManifest.scripts?.[script]).toContain(tool);
  }
  expect(workspaceTurbo.tasks?.lint?.dependsOn).toEqual(
    expect.arrayContaining([
      "$TURBO_EXTENDS$",
      "lint:biome",
      "lint:eslint",
      "lint:dependencies",
    ])
  );
  expect(rootTurbo.tasks?.lint?.dependsOn).toContain("^lint");
});
