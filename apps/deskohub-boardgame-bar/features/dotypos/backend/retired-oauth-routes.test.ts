import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression guard for the retired unauthenticated Dotypos OAuth
 * credential-provisioning chain. These routes were removed because they
 * could expose the Dotypos client secret and tokens without
 * authentication. If any of these files reappear, this test fails.
 */

const appRoot = join(import.meta.dir, "..", "..", "..", "app");

const retiredPaths = [
  "[locale]/admin/dotypos/page.tsx",
  "[locale]/admin/dotypos/callback/page.tsx",
  "api/admin/dotypos/auth-url/route.ts",
  "api/admin/dotypos/auth-url/route.test.ts",
  "api/admin/dotypos/token/route.ts",
  "api/admin/dotypos/token/route.test.ts",
  // Also assert previously retired files stay gone.
  "[locale]/admin/dotypos-setup/page.tsx",
  "api/dotypos/callback/route.ts",
];

const credentialLeakPatterns = [
  "client_secret",
  "connect/account",
  "refresh_token",
];

const collectSourceFiles = (dir: string): string[] => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(entryPath);
    if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      return [entryPath];
    }
    return [];
  });
};

describe("retired Dotypos OAuth routes", () => {
  test("retired oauth route files do not exist", () => {
    for (const retiredPath of retiredPaths) {
      expect(existsSync(join(appRoot, retiredPath))).toBe(false);
    }
  });

  test("no credential provisioning remains under admin dotypos routes", () => {
    for (const boundary of [
      join(appRoot, "api", "admin", "dotypos"),
      join(appRoot, "[locale]", "admin", "dotypos"),
    ]) {
      for (const filePath of collectSourceFiles(boundary)) {
        const source = readFileSync(filePath, "utf8");
        for (const pattern of credentialLeakPatterns) {
          expect(source).not.toContain(pattern);
        }
      }
    }
  });
});
