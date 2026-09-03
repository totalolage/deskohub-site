export type BetterAuthHostEnvironment = {
  readonly vercelEnv: "development" | "preview" | "production";
  readonly productionUrl: string | undefined;
  readonly commitUrl: string | undefined;
  readonly branchUrl: string | undefined;
};

export type BetterAuthHostsMessage =
  | "The canonical production host is not configured for Better Auth."
  | "Wildcard hosts are not allowed for Better Auth.";

export type BetterAuthAllowedHostsResult =
  | { readonly kind: "valid"; readonly hosts: readonly string[] }
  | { readonly kind: "invalid"; readonly message: BetterAuthHostsMessage };

const localDevelopmentHost = "localhost:3000";

const toHost = (url: string): string => {
  const withoutProtocol = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  return withoutProtocol.replace(/\/+.*$/, "").toLowerCase();
};

const plainHostResult = (host: string): BetterAuthAllowedHostsResult => {
  if (host.includes("*")) {
    return {
      kind: "invalid",
      message: "Wildcard hosts are not allowed for Better Auth.",
    };
  }
  if (!host) {
    return {
      kind: "invalid",
      message:
        "The canonical production host is not configured for Better Auth.",
    };
  }
  return { kind: "valid", hosts: [host] };
};

/**
 * Resolves the exact Better Auth `allowedHosts` entries from the Vercel
 * deployment environment. Only the canonical production host, the exact
 * commit host, the exact branch host, and local development are trusted;
 * wildcard patterns fail closed.
 */
export const resolveBetterAuthAllowedHosts = (
  environment: BetterAuthHostEnvironment
): BetterAuthAllowedHostsResult => {
  if (!environment.productionUrl) {
    return {
      kind: "invalid",
      message:
        "The canonical production host is not configured for Better Auth.",
    };
  }

  const candidateUrls = [
    environment.productionUrl,
    environment.commitUrl,
    environment.branchUrl,
    ...(environment.vercelEnv === "development" ? [localDevelopmentHost] : []),
  ].filter((url): url is string => Boolean(url));

  const hosts: string[] = [];
  for (const url of candidateUrls) {
    const result = plainHostResult(toHost(url));
    if (result.kind === "invalid") return result;
    const host = result.hosts[0]!;
    if (!hosts.includes(host)) hosts.push(host);
  }

  return { kind: "valid", hosts };
};
