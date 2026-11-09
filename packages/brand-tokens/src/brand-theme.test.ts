import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { brandThemeVariables } from "./index";

const readThemeVariables = async (): Promise<
  Partial<Record<string, string>>
> => {
  const css = (
    await readFile(join(import.meta.dir, "brand-theme.css"), "utf8")
  ).replace(/\/\*[\s\S]*?\*\//g, "");
  const rootBlock = css.trim().match(/^:root\s*\{([^{}]*)\}$/);
  if (!rootBlock?.[1]) {
    throw new Error("brand-theme.css must hold exactly one :root block.");
  }
  return Object.fromEntries(
    rootBlock[1]
      .split(";")
      .map((declaration) => declaration.trim())
      .filter(Boolean)
      .map((declaration) => {
        const separator = declaration.indexOf(":");
        return [
          declaration.slice(0, separator).trim(),
          declaration
            .slice(separator + 1)
            .replace(/\s+/g, " ")
            .trim(),
        ];
      })
  );
};

describe("brand-theme.css", () => {
  test("declares exactly the brand theme variables", async () => {
    expect(await readThemeVariables()).toEqual({ ...brandThemeVariables });
  });

  test("keeps the site's brand values", async () => {
    const variables = await readThemeVariables();

    expect(variables["--brand-navy-blue"]).toBe("#00024f");
    expect(variables["--radius"]).toBe("0.65rem");
    expect(variables["--font-body"]).toBe(
      'var(--font-sculpin), "Avenir Next", "Segoe UI", "Helvetica Neue", Arial, sans-serif'
    );
    expect(variables["--font-body-weight"]).toBe("400");
  });
});
