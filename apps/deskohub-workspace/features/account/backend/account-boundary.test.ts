import { describe, expect, mock, test } from "bun:test";
import type { TSESTree } from "@typescript-eslint/types";
import { isString } from "effect/Predicate";
import {
  exportedNames,
  identifierNames,
  importSpecifiers,
  nodesOf,
  parseTrackedSource,
  stringLiterals,
} from "@/scripts/shared/source-ast";
import { updateCustomerProfileStandardSchema } from "../contracts";

const accountDirectory = (await import("node:path")).resolve(
  import.meta.dir,
  ".."
);

const parsedAccountFile = (relativePath: string) =>
  parseTrackedSource(`${accountDirectory}/${relativePath}`);

const listAccountFiles = async (
  directory: string = accountDirectory
): Promise<string[]> => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listAccountFiles(entryPath)));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
};

const AUTH_MODULE_PATTERN = /^(better-auth|@better-auth\/[\w-]+(?:\/[\w-]+)?)$/;

/** Import specifiers of a parsed module that resolve into Better Auth. */
const betterAuthImports = (ast: TSESTree.Program): readonly string[] =>
  importSpecifiers(ast).filter((specifier) =>
    AUTH_MODULE_PATTERN.test(specifier)
  );

/** Every identifier, member property, and string literal in the module. */
const referencedNames = (ast: TSESTree.Program): ReadonlySet<string> => {
  const names = new Set<string>(identifierNames(ast));
  for (const literal of stringLiterals(ast)) names.add(literal.value);
  return names;
};

describe("Customer-account boundary", () => {
  test("exposes exactly the descendant compatibility exports from the barrel", () => {
    const { ast } = parsedAccountFile("index.ts");
    const exported = exportedNames(ast);

    for (const requiredName of [
      "CustomerAccountResolver",
      "resolveCurrentCustomerAccount",
      "CustomerAccountAccessError",
      "CustomerAccountId",
      "LinkedCustomerAccount",
    ]) {
      expect(exported).toContain(requiredName);
    }

    // No wildcard re-export: the barrel lists every descendant export.
    expect(exported).not.toContain("*");
  });

  test("keeps CustomerAccountResolver.Live and the page convenience wired", async () => {
    const { CustomerAccountResolver, resolveCurrentCustomerAccount } =
      await import("./customer-account-resolver.service");

    expect(CustomerAccountResolver.Live).toBeDefined();
    expect(resolveCurrentCustomerAccount).toBeDefined();
    expect((CustomerAccountResolver as { Live?: unknown }).Live).toBeDefined();
  });

  test("keeps every authoritative server session read refresh-free so the browser route owns the rolling cookie", async () => {
    const { makeAuthoritySessionRead } = await import(
      "./customer-authentication.service"
    );
    const recordedSessionInputs: Array<{
      readonly query: { readonly disableRefresh: true };
      readonly headers: Headers;
    }> = [];
    const readSession = makeAuthoritySessionRead({
      readRequestHeaders: async () => new Headers({ "x-e2e-probe": "1" }),
      loadAuthority: async () => ({
        auth: {
          api: {
            getSession: async (input: {
              readonly query: { readonly disableRefresh: true };
              readonly headers: Headers;
            }) => {
              recordedSessionInputs.push(input);
              return null;
            },
          },
        },
      }),
    });

    expect(await readSession()).toBeNull();
    expect(recordedSessionInputs.length).toBe(1);
    expect(recordedSessionInputs[0]?.query).toEqual({ disableRefresh: true });
    expect(recordedSessionInputs[0]?.headers.get("x-e2e-probe")).toBe("1");
  });

  test("confines Better Auth imports to the auth boundary, the session adapter, and the browser client", async () => {
    const files = await listAccountFiles();
    const offenders: string[] = [];

    for (const file of files) {
      const importsBetterAuth =
        betterAuthImports(parseTrackedSource(file).ast).length > 0;
      const withinAuthBoundary =
        file.includes(`${accountDirectory}/backend/auth/`) ||
        file.includes(
          `${accountDirectory}/backend/customer-authentication.service.ts`
        ) ||
        file.includes(`${accountDirectory}/auth.client.ts`);
      if (importsBetterAuth && !withinAuthBoundary) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });

  test("keeps Better Auth type names out of the domain surface", () => {
    for (const domainFile of [
      "customer-account.ts",
      "contracts.ts",
      "index.ts",
      "backend/customer-account-resolver.service.ts",
      "backend/customer-account-link.repository.ts",
      "backend/customer-profile.service.ts",
      "backend/customer-reservation-history.service.ts",
      "backend/customer-account-deletion.ts",
    ]) {
      const { ast } = parsedAccountFile(domainFile);
      const names = referencedNames(ast);
      expect(
        [...names].some(
          (name) => name.includes("better-auth") || name.includes("BetterAuth")
        )
      ).toBe(false);
    }
  });

  test("executes the auth route handler and forces private, no-store onto the response", async () => {
    const handlerCalls: Request[] = [];
    mock.module("@/features/account/server/auth.server", () => ({
      auth: {
        handler: async (request: Request) => {
          handlerCalls.push(request);
          const response = Response.json({ ok: true });
          response.headers.append(
            "Set-Cookie",
            "workspace_session=fake; Path=/; HttpOnly"
          );
          return response;
        },
      },
    }));

    try {
      const route = await import("../../../app/api/auth/[...all]/route");

      // The official route exposes exactly the GET/POST surface.
      expect(route.GET).toBeDefined();
      expect(route.POST).toBe(route.GET);
      expect(route.PUT).toBeUndefined();
      expect(route.PATCH).toBeUndefined();
      expect(route.DELETE).toBeUndefined();

      const response = await route.GET(
        new Request("https://deskohub.test/api/auth/get-session")
      );
      expect(handlerCalls.length).toBe(1);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("set-cookie")).toContain(
        "workspace_session=fake"
      );
    } finally {
      mock.restore();
    }

    // No React auth provider exists beside the route handler.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    await expect(
      fs.access(path.resolve(accountDirectory, "components/auth-provider.tsx"))
    ).rejects.toThrow();
  });

  test("keeps client and server directives out of the backend and confines the browser client", async () => {
    const files = (await listAccountFiles()).filter(
      (file) => !file.includes("account-boundary.test")
    );
    for (const file of files) {
      const { ast } = parseTrackedSource(file);
      const isBackendFile = file.includes("/backend/");
      // A runtime directive is a leading string-literal expression
      // statement, visible in the tree regardless of quote style.
      const directives = nodesOf(ast).flatMap((node) =>
        node.type === "ExpressionStatement" &&
        node.expression.type === "Literal" &&
        isString(node.expression.value)
          ? [node.expression.value]
          : []
      );
      if (isBackendFile) {
        expect(directives).not.toContain("use client");
        expect(directives).not.toContain("use server");
      }
      const names = referencedNames(ast);
      if (!file.includes(`${accountDirectory}/auth.client.ts`)) {
        expect(names.has("createAuthClient")).toBe(false);
      }
      expect(names.has("toNextJsHandler")).toBe(false);
    }
  });

  test("never logs raw auth or provider values in the account backend", async () => {
    const backendFiles = (await listAccountFiles()).filter((file) =>
      file.includes("/backend/")
    );

    for (const file of backendFiles) {
      const { ast } = parseTrackedSource(file);
      const consoleCalls = nodesOf(ast).flatMap((node) =>
        node.type === "MemberExpression" &&
        !node.computed &&
        node.object.type === "Identifier" &&
        node.object.name === "console" &&
        node.property.type === "Identifier" &&
        ["log", "info", "warn", "error"].includes(node.property.name)
          ? [node.property.name]
          : []
      );
      expect(consoleCalls).toEqual([]);

      // A tagged logging helper must never receive the raw email or URL.
      const leakingLogCalls = nodesOf(ast).filter((node) => {
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
  });

  test("profile input refuses an email field entirely", () => {
    const result = updateCustomerProfileStandardSchema["~standard"].validate({
      firstName: "Ada",
      email: "ada@example.test",
    });

    expect(result).not.toBeInstanceOf(Promise);
    const settled = result as { issues?: unknown[]; value?: unknown };
    expect(settled.issues?.length ?? 0).toBeGreaterThan(0);
  });
});
