import { appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { $ } from "bun";
import { Schema } from "effect";

const vercelApiOrigin = "https://api.vercel.com";

const workspaceProductionDomain = "deskohub-workspace-site.vercel.app";
const signInPath = "/en-US/auth/sign-in";
const authSessionPath = "/api/auth/get-session";
const authSessionCacheControl = "private, no-store";
const signInFormMarker = 'id="account-sign-in-form"';

const requiredCronPaths = [
  "/api/cron/workspace/reservation-holds",
  "/api/cron/workspace/auth-cleanup",
] as const;

const productionAliasResponse = Schema.Struct({
  deployment: Schema.Struct({
    id: Schema.NullOr(Schema.String),
    url: Schema.NullOr(Schema.String),
  }),
});

const projectCronsResponse = Schema.Struct({
  crons: Schema.Array(Schema.Struct({ path: Schema.optional(Schema.String) })),
});

const requireEnv = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const vercelApiGet = async (
  pathWithQuery: string,
  token: string
): Promise<unknown> => {
  const response = await fetch(`${vercelApiOrigin}${pathWithQuery}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(
      `Vercel API ${pathWithQuery} failed with ${response.status}`
    );
  }
  return response.json() as unknown;
};

/**
 * Anonymous Better Auth readiness probe: the deployment must answer an
 * unauthenticated session request with a healthy null session marked
 * private/no-store. Never sends a magic link and never reads a token.
 */
export const assertAuthSessionReady = async (
  baseUrl: string,
  fetchImpl: typeof fetch = fetch
) => {
  const response = await fetchImpl(new URL(authSessionPath, baseUrl));
  if (response.status !== 200) {
    throw new Error(
      `Auth session probe failed with ${response.status} on the deployed runtime`
    );
  }
  const cacheControl = response.headers.get("cache-control");
  if (cacheControl !== authSessionCacheControl) {
    throw new Error(
      `Auth session probe sent Cache-Control ${cacheControl ?? "without a policy"} instead of ${authSessionCacheControl}`
    );
  }
  const body = (await response.text()).trim();
  if (body !== "null") {
    throw new Error("Auth session probe did not return a healthy null session");
  }
};

/**
 * Canonical production smoke: the anonymous session endpoint and the public
 * sign-in page must both be healthy. Deliberately never requests a magic
 * link; delivery is proven by the exact-SHA preview E2E.
 */
export const assertCanonicalSignInReady = async (
  fetchImpl: typeof fetch = fetch
) => {
  const base = `https://${workspaceProductionDomain}`;
  await assertAuthSessionReady(base, fetchImpl);
  const response = await fetchImpl(new URL(signInPath, base));
  if (response.status !== 200) {
    throw new Error(
      `Canonical sign-in page probe failed with ${response.status}`
    );
  }
  if (!(await response.text()).includes(signInFormMarker)) {
    throw new Error(
      "Canonical sign-in page did not render the magic-link form"
    );
  }
};

export type ProductionRollbackTarget = {
  readonly id: string | null;
  readonly url: string;
};

/**
 * Resolves the deployment that currently serves production traffic through
 * the canonical Workspace production alias. After a rollback several older
 * deployments can have been promoted historically, so "newest promoted" is
 * not authoritative — the alias is what production traffic actually points
 * at, which makes it the only safe instant-rollback target.
 */
export const resolveProductionRollbackTarget = async (
  token: string,
  teamId: string | undefined
): Promise<ProductionRollbackTarget> => {
  const query = new URLSearchParams();
  if (teamId) query.set("teamId", teamId);
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const payload = Schema.decodeUnknownSync(productionAliasResponse)(
    await vercelApiGet(
      `/v4/aliases/${workspaceProductionDomain}${suffix}`,
      token
    )
  );
  const { id, url } = payload.deployment;
  if (!url) {
    throw new Error(
      "The canonical production alias serves no deployment url to retain"
    );
  }
  return { id, url };
};

export const assertRegisteredCrons = async (
  projectId: string,
  token: string,
  teamId: string | undefined
) => {
  const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
  const payload = Schema.decodeUnknownSync(projectCronsResponse)(
    await vercelApiGet(
      `/v1/projects/${encodeURIComponent(projectId)}/crons${query}`,
      token
    )
  );
  const registered = new Set(payload.crons.map((cron) => cron.path ?? ""));
  for (const path of requiredCronPaths) {
    if (!registered.has(path)) {
      throw new Error(
        `The account cleanup cron is not registered: missing ${path}`
      );
    }
  }
};

/**
 * Instant rollback to the retained promoted deployment. Vercel's rollback
 * operation repoints production traffic atomically; promoting a prior
 * deployment would instead disable auto-assignment of the production domain.
 */
const rollbackToDeployment = async (url: string) => {
  const token = requireEnv("VERCEL_TOKEN");
  const deployment =
    await $`bunx vercel@54.9.1 rollback ${url} --scope filip-kalny-projects --yes --timeout 10m --token ${token}`
      .cwd(fileURLToPath(new URL("../..", import.meta.url)))
      .quiet()
      .nothrow();
  if (deployment.exitCode !== 0) {
    process.stderr.write(deployment.stderr.toString());
    throw new Error(
      `Vercel rollback failed with exit code ${deployment.exitCode}`
    );
  }
};

/**
 * Emits the retained rollback target for the release workflow. The masked
 * deployment url is the only stdout content, and the step output travels
 * exclusively through the GITHUB_OUTPUT file that the rollback condition
 * reads. An unresolvable alias fails closed before the release builds
 * anything, so the workflow never promotes without a retained target.
 */
export const emitRollbackTarget = async (): Promise<void> => {
  const target = await resolveProductionRollbackTarget(
    requireEnv("VERCEL_TOKEN"),
    process.env.VERCEL_ORG_ID
  );
  process.stdout.write(`::add-mask::${target.url}\n`);
  await appendFile(requireEnv("GITHUB_OUTPUT"), `previous_url=${target.url}\n`);
};

const usage = (message?: string): never => {
  if (message) process.stderr.write(`${message}\n`);
  process.stderr.write(
    "Usage: production-release.ts <resolve-previous|probe|verify-canonical|verify-crons|rollback> [--url <url>]\n"
  );
  process.exit(1);
};

const readUrlOption = (): string => {
  const index = process.argv.indexOf("--url");
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (!value) return usage("--url is required");
  return value;
};

const run = async () => {
  const command = process.argv[2];
  const vercelToken = requireEnv("VERCEL_TOKEN");
  const projectId = requireEnv("VERCEL_PROJECT_ID");
  const teamId = process.env.VERCEL_ORG_ID;

  switch (command) {
    case "resolve-previous": {
      await emitRollbackTarget();
      return;
    }
    case "probe": {
      await assertAuthSessionReady(readUrlOption());
      return;
    }
    case "verify-canonical": {
      await assertCanonicalSignInReady();
      return;
    }
    case "verify-crons": {
      await assertRegisteredCrons(projectId, vercelToken, teamId);
      return;
    }
    case "rollback": {
      await rollbackToDeployment(readUrlOption());
      return;
    }
    default:
      usage(`Unsupported command: ${command}`);
  }
};

if (import.meta.main) {
  run().catch((cause: unknown) => {
    process.stderr.write(
      `${cause instanceof Error ? cause.message : String(cause)}\n`
    );
    process.exit(1);
  });
}
