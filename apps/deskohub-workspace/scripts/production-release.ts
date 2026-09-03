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

const productionDeploymentsResponse = Schema.Struct({
  deployments: Schema.Array(
    Schema.Struct({
      ready: Schema.NullOr(Schema.Finite),
      target: Schema.NullOr(Schema.String),
      url: Schema.NullOr(Schema.String),
      readySubstate: Schema.optional(Schema.String),
    })
  ),
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

/**
 * Captures the deployment that currently serves production traffic: the
 * newest READY production deployment that Vercel marks as PROMOTED. Staged
 * or rolling deployments ahead of it never served traffic, so they are
 * excluded — an instant rollback must land on the actually promoted one.
 */
export const resolvePreviousProductionDeployment = async (
  projectId: string,
  token: string,
  teamId: string | undefined
): Promise<string | undefined> => {
  const query = new URLSearchParams({
    limit: "20",
    projectId,
    state: "READY",
    target: "production",
  });
  if (teamId) query.set("teamId", teamId);
  const payload = Schema.decodeUnknownSync(productionDeploymentsResponse)(
    await vercelApiGet(`/v7/deployments?${query.toString()}`, token)
  );
  const promoted = payload.deployments
    .filter(
      (deployment) =>
        deployment.target === "production" &&
        deployment.url !== null &&
        deployment.ready !== null &&
        deployment.readySubstate === "PROMOTED"
    )
    .toSorted((left, right) => (right.ready ?? 0) - (left.ready ?? 0));
  return promoted[0]?.url ?? undefined;
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
      const previous = await resolvePreviousProductionDeployment(
        projectId,
        vercelToken,
        teamId
      );
      if (previous) {
        process.stdout.write(`::add-mask::${previous}\n`);
        process.stdout.write(`previous_url=${previous}\n`);
      } else {
        process.stdout.write("previous_url=\n");
      }
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
