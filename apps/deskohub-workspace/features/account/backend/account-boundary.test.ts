import { describe, expect, mock, test } from "bun:test";
import { updateCustomerProfileStandardSchema } from "../contracts";

const readFile = async (relativePath: string) =>
  Bun.file(`${accountDirectory}/${relativePath}`).text();

const accountDirectory = (await import("node:path")).resolve(
  import.meta.dir,
  ".."
);

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

describe("Customer-account boundary", () => {
  test("exposes exactly the descendant compatibility exports from the barrel", async () => {
    const source = await readFile("index.ts");
    const exportedNames = [
      ...source.matchAll(/export(?: type)?\s+\{([^}]*)\}/g),
    ]
      .flatMap((match) => match[1]!.split(","))
      .map((name) =>
        name
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)
          .pop()!
          .trim()
      )
      .filter(Boolean);

    for (const requiredName of [
      "CustomerAccountResolver",
      "resolveCurrentCustomerAccount",
      "CustomerAccountAccessError",
      "CustomerAccountId",
      "LinkedCustomerAccount",
    ]) {
      expect(exportedNames).toContain(requiredName);
    }

    expect(source).not.toMatch(/export \*/);
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
      const source = await Bun.file(file).text();
      const importsBetterAuth =
        /from\s+"(better-auth|@better-auth\/[\w-]+(?:\/[\w-]+)?)"/.test(source);
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

  test("keeps Better Auth type names out of the domain surface", async () => {
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
      const source = await readFile(domainFile);
      expect(source).not.toMatch(/BetterAuth|better-auth/);
    }
  });

  test("exposes the official GET/POST auth route without a React auth provider", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    const routeSource = await Bun.file(
      path.resolve(accountDirectory, "../../app/api/auth/[...all]/route.ts")
    ).text();
    expect(/export const GET/.test(routeSource)).toBe(true);
    expect(/export const POST/.test(routeSource)).toBe(true);
    expect(/export const (PUT|PATCH|DELETE)\b/.test(routeSource)).toBe(false);

    await expect(
      fs.access(path.resolve(accountDirectory, "components/auth-provider.tsx"))
    ).rejects.toThrow();
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

      expect(route.POST).toBe(route.GET);
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
  });

  test("keeps client and server directives out of the backend and confines the browser client", async () => {
    const files = (await listAccountFiles()).filter(
      (file) => !file.includes("account-boundary.test")
    );
    for (const file of files) {
      const source = await Bun.file(file).text();
      const isBackendFile = file.includes("/backend/");
      if (isBackendFile) {
        expect(source).not.toContain("use client");
        expect(source).not.toContain("use server");
      }
      if (!file.includes(`${accountDirectory}/auth.client.ts`)) {
        expect(source).not.toContain("createAuthClient");
      }
      expect(source).not.toContain("toNextJsHandler");
    }
  });

  test("never logs raw auth or provider values in the account backend", async () => {
    const backendFiles = (await listAccountFiles()).filter((file) =>
      file.includes("/backend/")
    );

    for (const file of backendFiles) {
      const source = await Bun.file(file).text();
      expect(source).not.toMatch(/\bconsole\.(log|info|warn|error)\b/);
      expect(source).not.toMatch(
        /log(Info|Warning|Error|Debug)\([^)]*\b(data\.(url|token)|data\.email)\b/
      );
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
