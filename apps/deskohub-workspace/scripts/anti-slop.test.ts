import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const decoder = new TextDecoder();

const lint = (source: string, workspaceDirectory = "scripts") => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "deskohub-anti-slop-"));
  const directory = join(
    temporaryRoot,
    "apps/deskohub-workspace",
    workspaceDirectory
  );
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "probe.ts");
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
const payload: unknown = JSON.parse("{}");
void result;
void payload;
`);

  expect(result.exitCode).toBe(0);
});

test("anti-slop reports all ten rules", () => {
  const result = lint(`
declare const externalValue: unknown;
const chained = externalValue as unknown as { value: string };
const conditionalSpread = { ...(true ? { value: 1 } : {}) };
const widened: unknown = { value: 1 };
const objectParameter = (_value: object) => undefined;
const runtimeType = typeof externalValue;
const payloadShape = 1;
const unknownParameter = (_value: unknown) => undefined;
type HiddenUnknown = unknown;
type UnsafeDictionary = Record<string, unknown>;
const evidence: unknown = { value: 1 };
const reconstructed = evidence as { value: number };
void chained;
void conditionalSpread;
void widened;
void objectParameter;
void runtimeType;
void payloadShape;
void unknownParameter;
void reconstructed;
`);
  const output = `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`;

  for (const rule of [
    "no-chained-type-assertions",
    "no-conditional-empty-object-spread",
    "no-known-value-widening",
    "no-object-parameters",
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

test("chained assertion rule retains Workspace e2e coverage", () => {
  const result = lint(
    "declare const value: unknown; value as unknown as string;",
    "e2e"
  );
  const output = `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`;

  expect(output).toContain("[anti-slop/no-chained-type-assertions]");
});
