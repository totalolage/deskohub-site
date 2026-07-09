import type { Effect } from "effect";
import { effectifySync, type WorkspaceE2EError } from "./errors";

export const makeUrl = (
  operation: string,
  input: string,
  base?: string
): Effect.Effect<URL, WorkspaceE2EError> =>
  effectifySync(operation, () =>
    base === undefined ? new URL(input) : new URL(input, base)
  );

export const setSearchParams = (
  url: URL,
  params: Readonly<Record<string, string>>
): Effect.Effect<URL, WorkspaceE2EError> =>
  effectifySync("set URL search params", () => {
    for (const [key, value] of Object.entries(params))
      url.searchParams.set(key, value);
    return url;
  });
