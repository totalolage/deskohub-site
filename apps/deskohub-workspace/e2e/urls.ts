import type { Effect } from "effect";
import { tryWorkspaceE2ESync, type WorkspaceE2EError } from "./errors";

export const makeUrl = (
  operation: string,
  input: string,
  base?: string
): Effect.Effect<URL, WorkspaceE2EError> =>
  tryWorkspaceE2ESync(operation, () =>
    base === undefined ? new URL(input) : new URL(input, base)
  );

export const setSearchParams = (
  url: URL,
  params: Readonly<Record<string, string>>
): Effect.Effect<URL, WorkspaceE2EError> =>
  tryWorkspaceE2ESync("set URL search params", () => {
    for (const [key, value] of Object.entries(params))
      url.searchParams.set(key, value);
    return url;
  });

export const isCheckoutStatusUrl = (value: string | undefined) => {
  try {
    return new URL(value ?? "").pathname.includes("/reservation/status/");
  } catch {
    return false;
  }
};

export const isExpectedCheckoutStatusUrl = (
  value: string,
  expectedHost: string
) => {
  try {
    const url = new URL(value);
    return (
      url.host === expectedHost && url.pathname.includes("/reservation/status/")
    );
  } catch {
    return false;
  }
};

// Nexi hosted-field API calls (card data, state, validate-and-pay) that the
// hosted payment page makes on its own origin.
export const isNexiBuildApiUrl = (url: URL) =>
  url.hostname.endsWith(".nexigroup.com") &&
  /^\/fe\/(?:v2\/)?build\//.test(url.pathname);
