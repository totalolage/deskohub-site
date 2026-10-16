export type BetterAuthHostEnvironment = {
  readonly vercelEnv: "development" | "preview" | "production";
  readonly customerFacingHost: string | undefined;
  readonly projectProductionUrl: string | undefined;
  readonly deploymentUrl: string | undefined;
  readonly branchUrl: string | undefined;
};

type BetterAuthHostsMessage =
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
  if (host.includes("*") || host.includes("?")) {
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
 * Resolves the exact Better Auth `allowedHosts` entries. The customer-facing
 * production host is the canonical authority and must always be configured;
 * the Vercel project, deployment, and branch hosts are trusted only as exact
 * matches, and local development additionally allows localhost. Wildcard
 * patterns fail closed.
 */
export const resolveBetterAuthAllowedHosts = (
  environment: BetterAuthHostEnvironment
): BetterAuthAllowedHostsResult => {
  if (!environment.customerFacingHost) {
    return {
      kind: "invalid",
      message:
        "The canonical production host is not configured for Better Auth.",
    };
  }

  const candidateUrls = [
    environment.customerFacingHost,
    environment.projectProductionUrl,
    environment.deploymentUrl,
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

/**
 * The WebAuthn relying party of one deployment: the RP ID every passkey is
 * scoped to and the exact origins its ceremonies may come from.
 */
export type PasskeyRelyingParty = {
  readonly rpID: string;
  readonly origins: readonly string[];
};

type PasskeyRelyingPartyMessage =
  | BetterAuthHostsMessage
  | "The preview deployment host is not configured for passkeys.";

export type PasskeyRelyingPartyResult =
  | { readonly kind: "valid"; readonly relyingParty: PasskeyRelyingParty }
  | { readonly kind: "invalid"; readonly message: PasskeyRelyingPartyMessage };

const hostname = (host: string) => host.replace(/:\d+$/, "");

const localRelyingPartyId = "localhost";

/**
 * Resolves the passkey relying party from the same environment as the
 * `allowedHosts` list. Production uses the canonical customer-facing host,
 * which stays fixed because changing it orphans every passkey. A preview
 * uses its immutable deployment host, since `vercel.app` is a public suffix
 * and its branch alias can't share the RP ID. Local development uses
 * `localhost` over plain HTTP on each allowed localhost port. The RP ID is
 * always explicit: the plugin's own fallback reads only a string `baseURL`.
 */
export const resolvePasskeyRelyingParty = (
  environment: BetterAuthHostEnvironment
): PasskeyRelyingPartyResult => {
  const allowedHosts = resolveBetterAuthAllowedHosts(environment);
  if (allowedHosts.kind === "invalid") return allowedHosts;

  if (environment.vercelEnv === "development") {
    return {
      kind: "valid",
      relyingParty: {
        rpID: localRelyingPartyId,
        origins: allowedHosts.hosts
          .filter((host) => hostname(host) === localRelyingPartyId)
          .map((host) => `http://${host}`),
      },
    };
  }

  const relyingPartyUrl =
    environment.vercelEnv === "production"
      ? environment.customerFacingHost
      : environment.deploymentUrl;
  if (!relyingPartyUrl) {
    return {
      kind: "invalid",
      message: "The preview deployment host is not configured for passkeys.",
    };
  }
  const host = toHost(relyingPartyUrl);
  return {
    kind: "valid",
    relyingParty: { rpID: hostname(host), origins: [`https://${host}`] },
  };
};
