import { describe, expect, test } from "bun:test";
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
    const source = await readFile(
      "backend/customer-account-resolver.service.ts"
    );

    expect(source).toContain("static Live");
    expect(source).toContain("export const resolveCurrentCustomerAccount");
    expect(source).toContain(
      "@deskohub-workspace/account/CustomerAccountResolver"
    );
  });

  test("confines Better Auth imports to the auth adapter and auth modules", async () => {
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
        );
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

  test("adds no HTTP auth route, client auth provider, pages, or server actions", async () => {
    const fs = await import("node:fs/promises");

    await expect(
      fs.access(
        (await import("node:path")).resolve(
          accountDirectory,
          "../../app/api/auth"
        )
      )
    ).rejects.toThrow();

    const files = (await listAccountFiles()).filter(
      (file) => !file.includes("account-boundary.test")
    );
    for (const file of files) {
      const source = await Bun.file(file).text();
      expect(source).not.toContain("use client");
      expect(source).not.toContain("use server");
      expect(source).not.toContain("toNextJsHandler");
      expect(source).not.toContain("createAuthClient");
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
