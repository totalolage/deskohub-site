import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const decoder = new TextDecoder();

const lint = (
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
    return Bun.spawnSync({
      cmd: [
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
      cwd: repositoryRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
};

test("anti-slop allows independent assertions and parsed unknown values", () => {
  const result = lint(`
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

test("unknown parameter rule allows error causes", () => {
  const result = lint(`
const handleFailure = (cause: unknown) => String(cause);
void handleFailure;
`);
  const output = `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`;

  expect(output).not.toContain("[anti-slop/no-unknown-parameters]");
});

test("anti-slop reports all eleven rules", () => {
  const result = lint(`
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
  const output = `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`;

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

test("repeated computed conditional operand rule allows independent branches", () => {
  const result = lint(`
declare const condition: boolean;
declare function loadValue(): string;
const value = condition ? loadValue() : null;
void value;
`);
  const output = `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`;

  expect(output).not.toContain(
    "[anti-slop/no-repeated-computed-conditional-operand]"
  );
});

test("chained assertion rule retains Workspace e2e coverage", () => {
  const result = lint(
    "declare const value: unknown; value as unknown as string;",
    "e2e"
  );
  const output = `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`;

  expect(output).toContain("[anti-slop/no-chained-type-assertions]");
});

test("chained assertion rule retains the E2E run plan", () => {
  const result = lint(
    "declare const value: object; value as unknown as { id: string };",
    "e2e/playwright-checkout",
    "run-plan.ts"
  );
  const output = `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`;

  expect(output).toContain("[anti-slop/no-chained-type-assertions]");
});

test("chained assertion rule retains test utility coverage", () => {
  const result = lint(
    "declare const value: object; value as unknown as { id: string };",
    "shared/testing",
    "fixture.test-utils.ts"
  );
  const output = `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`;

  expect(output).toContain("[anti-slop/no-chained-type-assertions]");
});

test("shape rule ignores external property names", () => {
  const result = lint(
    `
declare function configure(value: { defaultValidationErrorsShape: string }): void;
configure({ defaultValidationErrorsShape: "flattened" });
const view = <Map tableShapeInlineStyle={() => ({})} />;
void view;
`,
    "scripts",
    "probe.tsx"
  );
  const output = `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`;

  expect(output).not.toContain("[anti-slop/no-shape-in-symbol-names]");
});

test("chained assertion rule unwraps nested parentheses", () => {
  const result = lint(`
declare const value: unknown;
const asserted = ((value as unknown)) as string;
void asserted;
`);
  const output = `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`;

  expect(output).toContain("[anti-slop/no-chained-type-assertions]");
});

test("conditional spread rule reports objects with sibling properties", () => {
  const result = lint(`
declare const condition: boolean;
const payload = { fixed: 1, ...(condition ? { value: 1 } : {}) };
void payload;
`);
  const output = `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`;

  expect(output).toContain("[anti-slop/no-conditional-empty-object-spread]");
});

test("conditional spread rule ignores conditionals inside spread calls", () => {
  const result = lint(`
declare const condition: boolean;
declare function normalize(value: { value?: number }): object;
const payload = { ...normalize(condition ? { value: 1 } : {}) };
void payload;
`);
  const output = `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`;

  expect(output).not.toContain(
    "[anti-slop/no-conditional-empty-object-spread]"
  );
});

test("known value widening allows empty dictionary accumulators", () => {
  const result = lint(`
const handlers: Record<string, string> = {};
handlers.start = "ready";
`);
  const output = `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`;

  expect(output).not.toContain("[anti-slop/no-known-value-widening]");
});

test("known value widening reports nested Record value types", () => {
  const result = lint(`
const handlers: Record<string, () => void> = { start: () => undefined };
void handlers;
`);
  const output = `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`;

  expect(output).toContain("[anti-slop/no-known-value-widening]");
});

test("widen-then-assert does not connect unrelated scopes", () => {
  const result = lint(`
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
  const output = `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`;

  expect(output).not.toContain("[anti-slop/no-widen-then-assert]");
});

test("widen-then-assert reports a direct top-level binding", () => {
  const result = lint(`
const evidence: unknown = { value: 1 };
const reconstructed = evidence as { value: number };
void reconstructed;
`);
  const output = `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`;

  expect(output).toContain("[anti-slop/no-widen-then-assert]");
});

test("widen-then-assert reports an outer binding despite nested shadowing", () => {
  const result = lint(`
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
  const output = `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`;

  expect(output).toContain("[anti-slop/no-widen-then-assert]");
});

test("unsafe dictionary allows concrete values containing unknown", () => {
  const result = lint(`
type AsyncValues = Record<string, Promise<unknown>>;
type AsyncUnionValues = Record<string, Promise<unknown | null>>;
type StructuredValues = Record<string, { value: unknown; source: string }>;
type NestedValues = { [key: string]: Promise<unknown> };
void (0 as unknown as AsyncValues);
void (0 as unknown as AsyncUnionValues);
void (0 as unknown as StructuredValues);
void (0 as unknown as NestedValues);
`);
  const output = `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`;

  expect(output).not.toContain("[anti-slop/no-unsafe-dictionary-type]");
});

test("unsafe dictionary reports direct unsafe union members", () => {
  const result = lint(`
type RecordValues = Record<string, unknown | undefined>;
type IndexedValues = { [key: string]: null | object };
void (0 as unknown as RecordValues);
void (0 as unknown as IndexedValues);
`);
  const output = `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`;

  expect(output).toContain("[anti-slop/no-unsafe-dictionary-type]");
});
