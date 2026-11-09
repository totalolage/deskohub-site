import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { TSESTree } from "@typescript-eslint/types";
import {
  containsNode,
  identifierNames,
  nodesOf,
  parseTrackedSource,
} from "@/scripts/shared/source-ast";

// Import and naming boundaries of the account feature are lint rules: see the
// account overrides in biome.json and lint/no-better-auth-in-account-domain.grit.

const backendDirectory = resolve(import.meta.dir);

const listBackendSources = async (
  directory: string = backendDirectory
): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listBackendSources(entryPath)));
    } else if (
      /\.(ts|tsx)$/.test(entry.name) &&
      !entry.name.includes(".test.")
    ) {
      files.push(entryPath);
    }
  }
  return files;
};

describe("Customer-account backend logging", () => {
  test("never logs raw auth or provider values in the account backend", async () => {
    // Permit only the bearer-link emitter for synthetic Preview and local
    // development in the account backend.
    const authorizedEmitterFile = `${backendDirectory}/auth/send-magic-link-email.ts`;
    const authorizedEmitterName = "emitAuthorizedMagicLinkLine";
    const authorizedLineType = "AuthorizedMagicLinkLine";
    const authorizedLogCodes = [
      "magicLinkPreviewE2ELogCode",
      "magicLinkDevelopmentLogCode",
    ];

    const isAuthorizedMagicLinkConsoleCall = (
      file: string,
      member: TSESTree.MemberExpression,
      nodes: readonly TSESTree.Node[]
    ): boolean => {
      if (file !== authorizedEmitterFile) return false;
      const property = member.property;
      if (property.type !== "Identifier" || property.name !== "log")
        return false;
      const emitter = nodes.find(
        (node) =>
          node.type === "VariableDeclarator" &&
          node.id.type === "Identifier" &&
          node.id.name === authorizedEmitterName
      );
      if (!emitter || !containsNode(emitter, member)) return false;
      // The emitter accepts only the line type whose codes are the approved
      // bearer-log codes.
      const lineType = nodes.find(
        (node) =>
          node.type === "TSTypeAliasDeclaration" &&
          node.id.name === authorizedLineType
      );
      return (
        identifierNames(emitter).has(authorizedLineType) &&
        lineType !== undefined &&
        authorizedLogCodes.every((code) => identifierNames(lineType).has(code))
      );
    };

    const consoleCalls: Array<{
      readonly method: string;
      readonly authorized: boolean;
    }> = [];

    for (const file of await listBackendSources()) {
      // Parse and walk each source once; every check below reads `nodes`.
      const nodes = nodesOf(parseTrackedSource(file).ast);
      for (const node of nodes) {
        if (
          node.type !== "MemberExpression" ||
          node.computed ||
          node.object.type !== "Identifier" ||
          node.object.name !== "console" ||
          node.property.type !== "Identifier" ||
          !["log", "info", "warn", "error"].includes(node.property.name)
        ) {
          continue;
        }
        consoleCalls.push({
          method: node.property.name,
          authorized: isAuthorizedMagicLinkConsoleCall(file, node, nodes),
        });
      }

      // A tagged logging helper must never receive the raw email or URL.
      const leakingLogCalls = nodes.filter((node) => {
        if (node.type !== "CallExpression") return false;
        const callee = node.callee;
        if (
          callee.type !== "Identifier" ||
          !/^log(Info|Warning|Error|Debug)$/.test(callee.name)
        ) {
          return false;
        }
        return node.arguments.some(
          (argument) =>
            identifierNames(argument).has("email") ||
            identifierNames(argument).has("url")
        );
      });
      expect(leakingLogCalls).toEqual([]);
    }

    expect(consoleCalls.length).toBeLessThanOrEqual(1);
    expect(consoleCalls.filter((call) => !call.authorized)).toEqual([]);
  });
});
