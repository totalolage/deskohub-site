import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { brandThemeVariables } from "@deskohub/brand-tokens";
import postcss, { type Root } from "postcss";
import { compileWorkspaceAppStyles } from "@/shared/testing/workspace-app-styles.test-utils";

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

const declarationsIn = (
  root: Root,
  isTarget: (node: postcss.Container) => boolean
) => {
  const declarations: Record<string, string> = {};
  root.walkDecls((declaration) => {
    if (declaration.parent && isTarget(declaration.parent)) {
      declarations[declaration.prop] = normalize(declaration.value);
    }
  });
  return declarations;
};

describe("brand theme", () => {
  test("the compiled site stylesheet declares the brand tokens", async () => {
    const compiled = postcss.parse(await compileWorkspaceAppStyles());
    const rootVariables = declarationsIn(
      compiled,
      (node) =>
        node.type === "rule" &&
        (node as postcss.Rule).selector === ":root" &&
        node.parent?.type === "root"
    );

    for (const [name, value] of Object.entries(brandThemeVariables)) {
      expect(rootVariables[name]).toBe(normalize(value ?? ""));
    }
  });

  test("Tailwind's font theme uses the brand font stacks", async () => {
    const source = postcss.parse(
      await readFile(join(import.meta.dir, "brand-theme.css"), "utf8")
    );
    const themeVariables = declarationsIn(
      source,
      (node) =>
        node.type === "atrule" &&
        (node as postcss.AtRule).name === "theme" &&
        (node as postcss.AtRule).params === "inline"
    );

    for (const role of ["heading", "subheading", "body"]) {
      expect(themeVariables[`--font-${role}`]).toBe(
        normalize(brandThemeVariables[`--font-${role}`] ?? "")
      );
    }
  });
});
