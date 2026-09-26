import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { TSESTree } from "@typescript-eslint/types";
import {
  importSpecifiers,
  methodCallsNamed,
  nodesOf,
  parseSource,
} from "./shared/source-ast";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const sourcePaths = [
  ...new Bun.Glob("{apps,packages}/**/*.{ts,tsx}").scanSync({
    cwd: repositoryRoot,
    absolute: true,
  }),
].filter(
  (path) =>
    !path.includes("/node_modules/") &&
    !path.includes("/generated/") &&
    !path.includes("/.next/")
);

type ParsedCapabilityModule = {
  readonly path: string;
  readonly ast: TSESTree.Program;
};

let cachedModules: readonly ParsedCapabilityModule[] | undefined;
/** Every tracked module parsed once per run. */
const parseCapabilityModules = (): readonly ParsedCapabilityModule[] => {
  if (cachedModules === undefined) {
    cachedModules = sourcePaths.map((path) => ({
      ast: parseSource(readFileSync(path, "utf8"), {
        jsx: path.endsWith(".tsx"),
      }),
      path,
    }));
  }
  return cachedModules;
};

/** `class X extends Context.Service` capability declarations. */
const declaredCapability = (node: TSESTree.Node): string | undefined => {
  if (node.type === "ClassDeclaration" && node.superClass) {
    const superClass = node.superClass;
    if (
      superClass.type === "MemberExpression" &&
      !superClass.computed &&
      superClass.object.type === "Identifier" &&
      superClass.object.name === "Context" &&
      superClass.property.type === "Identifier" &&
      superClass.property.name === "Service" &&
      node.id
    ) {
      return node.id.name;
    }
  }
  return undefined;
};

/** A standalone `XDefault` / `XLive` layer constant outside its capability. */
const standaloneLayerName = (node: TSESTree.Node): string | undefined => {
  if (node.type !== "VariableDeclarator" || node.id.type !== "Identifier") {
    return undefined;
  }
  return /^(?<capability>[A-Z][A-Za-z0-9]*?)(Default|Live(?:WithDependencies)?)$/.exec(
    node.id.name
  )?.groups?.capability;
};

test("Context capabilities own their default and live layers", () => {
  expect(sourcePaths.length).toBeGreaterThan(0);
  const modules = parseCapabilityModules();
  const capabilities = new Set<string>();

  for (const { ast } of modules) {
    for (const node of nodesOf(ast)) {
      const capability = declaredCapability(node);
      if (capability) capabilities.add(capability);
    }
  }

  const offenders: string[] = [];
  for (const { path, ast } of modules) {
    for (const node of nodesOf(ast)) {
      const capability = standaloneLayerName(node);
      if (capability !== undefined && capabilities.has(capability)) {
        offenders.push(
          `${relative(repositoryRoot, path)}: ${capability} layer constant`
        );
      }
    }
  }

  expect(offenders.sort()).toEqual([]);
});

test("fully wired capability layers are named Live", () => {
  const obsoleteName = ["Live", "With", "Dependencies"].join("");
  const offenders = parseCapabilityModules()
    .filter(({ ast }) =>
      nodesOf(ast).some(
        (node) => node.type === "Identifier" && node.name === obsoleteName
      )
    )
    .map(({ path }) => relative(repositoryRoot, path));

  expect(offenders.sort()).toEqual([]);
});

test("server-only feature flag providers are loaded lazily", () => {
  const { ast } = parseCapabilityModules().find(({ path }) =>
    path.endsWith(
      "apps/deskohub-workspace/features/feature-flags/backend/workspace-feature-flag.service.ts"
    )
  )!;
  const imports = importSpecifiers(ast);

  expect(imports).not.toContain("server-only");
  expect(imports.some((specifier) => specifier === "./node")).toBe(false);
  expect(imports.some((specifier) => specifier === "./subject")).toBe(false);
});

test("the Dotypos adapter retains its process-wide token cache", () => {
  const { ast } = parseCapabilityModules().find(({ path }) =>
    path.endsWith(
      "apps/deskohub-workspace/shared/backend/config/dotypos.config.ts"
    )
  )!;

  expect(
    methodCallsNamed(ast, "buildWithMemoMap").some(
      (call) =>
        call.callee.type === "MemberExpression" &&
        call.callee.object.type === "Identifier" &&
        call.callee.object.name === "Layer"
    )
  ).toBe(true);
});
