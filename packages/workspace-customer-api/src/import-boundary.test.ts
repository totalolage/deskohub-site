import { describe, expect, test } from "bun:test";
import { Glob } from "bun";

/**
 * The mobile app bundles this package with Metro for Hermes, and the
 * Workspace imports it on both sides of the Next boundary, so its source may
 * import only portable modules.
 */
const forbiddenImport =
  /\bfrom\s+["'](next(\/[^"']*)?|server-only|node:[^"']*|react(-dom|-native)?(\/[^"']*)?|@\/[^"']*|better-auth(\/[^"']*)?|@better-auth\/[^"']*)["']|\bimport\(\s*["'](next|server-only|node:|react|@\/|better-auth|@better-auth\/)/;

describe("customer API package imports", () => {
  test("no source file imports Next, Node built-ins, React, Better Auth or Workspace paths", async () => {
    const sourceDirectory = new URL(".", import.meta.url).pathname;
    const offenders: string[] = [];
    for await (const path of new Glob("**/*.ts").scan(sourceDirectory)) {
      if (path.endsWith(".test.ts")) continue;
      const source = await Bun.file(`${sourceDirectory}${path}`).text();
      if (forbiddenImport.test(source)) offenders.push(path);
    }

    expect(offenders).toEqual([]);
  });

  test("the referral code entry point imports only Effect", async () => {
    // Client components take it to validate codes; anything more would pull
    // the HTTP API contract into their bundles.
    const source = await Bun.file(
      new URL("./referral-code.ts", import.meta.url)
    ).text();
    const imports = [...source.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map(
      ([, specifier]) => specifier
    );

    expect(imports).toEqual(["effect"]);
  });

  test("the customer locale entry point imports only Effect and the locale registry", async () => {
    // The app takes it for its sign-in requests; anything more would pull
    // the HTTP API contract into its bundle.
    const source = await Bun.file(
      new URL("./customer-locale.ts", import.meta.url)
    ).text();
    const imports = [...source.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map(
      ([, specifier]) => specifier
    );

    expect(imports).toEqual(["@deskohub/i18n/locale-registry", "effect"]);
  });
});
