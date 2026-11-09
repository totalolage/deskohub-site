import { readFile } from "node:fs/promises";
import { join } from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import postcss from "postcss";

const workspaceAppStylesPath = join(import.meta.dir, "../../app/globals.css");

/** Compiles the app's Tailwind stylesheet for real-browser component tests. */
export const compileWorkspaceAppStyles = async (): Promise<string> => {
  const sourceStyles = await readFile(workspaceAppStylesPath, "utf8");
  return (
    await postcss([tailwindcss()]).process(sourceStyles, {
      from: workspaceAppStylesPath,
    })
  ).css;
};
