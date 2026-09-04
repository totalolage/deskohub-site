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

const defaultPollDeadlineMilliseconds = 10 * 60_000;
const defaultPollIntervalMilliseconds = 15_000;

const requiredCronPaths = [
  "/api/cron/workspace/reservation-holds",
  "/api/cron/workspace/auth-cleanup",
] as const;

const canonicalAliasResponse = Schema.Struct({
  projectId: Schema.optional(Schema.NullOr(Schema.String)),
  deployment: Schema.Struct({
    id: Schema.optional(Schema.NullOr(Schema.String)),
    url: Schema.NullOr(Schema.String),
  }),
});

const stagedDeploymentResponse = Schema.Struct({
  id: Schema.String,
  readyState: Schema.String,
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

const vercelApiQuery = (params: Record<string, string | undefined>) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
};

export type CanonicalAlias = {
  readonly deploymentId: string | null;
  readonly deploymentUrl: string;
  readonly projectId: string | null;
};

/**
 * Reads the deployment that serves the canonical Workspace production domain.
 * The lookup is constrained to the configured project and the returned
 * ownership is validated, so an alias that belongs to another project fails
 * closed instead of being mistaken for the production target.
 */
export const resolveCanonicalAlias = async (
  token: string,
  projectId: string,
  teamId: string | undefined
): Promise<CanonicalAlias> => {
  const payload = Schema.decodeUnknownSync(canonicalAliasResponse)(
    await vercelApiGet(
      `/v4/aliases/${workspaceProductionDomain}${vercelApiQuery({
        teamId,
        projectId,
      })}`,
      token
    )
  );
  if (payload.projectId !== projectId) {
    throw new Error(
      `The canonical production alias serves a different Vercel project (${
        payload.projectId ?? "unknown"
      } instead of ${projectId}); refusing to act on it`
    );
  }
  const { url } = payload.deployment;
  if (!url) {
    throw new Error(
      "The canonical production alias serves no deployment url to retain"
    );
  }
  return {
    deploymentId: payload.deployment.id ?? null,
    deploymentUrl: url,
    projectId: payload.projectId,
  };
};

const urlHostName = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

const aliasServesDeployment = (
  alias: CanonicalAlias,
  deployment: { readonly id: string | null; readonly url: string }
): boolean => {
  if (deployment.id && alias.deploymentId) {
    return alias.deploymentId === deployment.id;
  }
  return urlHostName(alias.deploymentUrl) === urlHostName(deployment.url);
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
  projectId: string,
  teamId: string | undefined
): Promise<ProductionRollbackTarget> => {
  const alias = await resolveCanonicalAlias(token, projectId, teamId);
  return { id: alias.deploymentId, url: alias.deploymentUrl };
};

export const assertRegisteredCrons = async (
  projectId: string,
  token: string,
  teamId: string | undefined
) => {
  const payload = Schema.decodeUnknownSync(projectCronsResponse)(
    await vercelApiGet(
      `/v1/projects/${encodeURIComponent(projectId)}/crons${vercelApiQuery({
        teamId,
      })}`,
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
    requireEnv("VERCEL_PROJECT_ID"),
    process.env.VERCEL_ORG_ID
  );
  process.stdout.write(`::add-mask::${target.url}\n`);
  await appendFile(requireEnv("GITHUB_OUTPUT"), `previous_url=${target.url}\n`);
};

const resolveStagedDeployment = async (
  stagedUrl: string,
  token: string,
  teamId: string | undefined
): Promise<{ readonly id: string; readonly readyState: string }> => {
  const host = urlHostName(stagedUrl);
  const payload = Schema.decodeUnknownSync(stagedDeploymentResponse)(
    await vercelApiGet(
      `/v13/deployments/${encodeURIComponent(host)}${vercelApiQuery({
        teamId,
      })}`,
      token
    )
  );
  return { id: payload.id, readyState: payload.readyState };
};

/**
 * Issues the promotion request. Vercel treats promotion as an asynchronous
 * operation: an accepted request keeps proceeding server-side, so this only
 * classifies the request itself. A definitive 4xx answer proves the request
 * was refused before any change; anything else stays "unknown" and the
 * canonical alias must decide the outcome.
 */
const requestPromotion = async (
  projectId: string,
  deploymentId: string,
  token: string,
  teamId: string | undefined
): Promise<"accepted" | "rejected" | "unknown"> => {
  let response: Response;
  try {
    response = await fetch(
      `${vercelApiOrigin}/v10/projects/${encodeURIComponent(
        projectId
      )}/promote/${encodeURIComponent(deploymentId)}${vercelApiQuery({
        teamId,
      })}`,
      { method: "POST", headers: { authorization: `Bearer ${token}` } }
    );
  } catch {
    return "unknown";
  }
  if (response.ok) return "accepted";
  if (response.status >= 400 && response.status < 500) return "rejected";
  return "unknown";
};

export type PollingOptions = {
  readonly pollDeadlineMilliseconds?: number;
  readonly pollIntervalMilliseconds?: number;
};

export type PollingDependencies = {
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
};

const makePolling = ({ sleep, now }: PollingDependencies = {}) => ({
  sleep: sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms))),
  now: now ?? (() => Date.now()),
});

/**
 * Bounded authoritative poll of the canonical production alias. Resolves
 * once the alias serves the expected deployment, or reports false when the
 * deadline passes without the alias ever confirming the deployment.
 */
const waitForCanonicalAlias = async (
  expected: { readonly id: string | null; readonly url: string },
  input: {
    readonly token: string;
    readonly projectId: string;
    readonly teamId: string | undefined;
  } & PollingOptions,
  dependencies: PollingDependencies = {}
): Promise<boolean> => {
  const { sleep, now } = makePolling(dependencies);
  const deadline =
    now() + (input.pollDeadlineMilliseconds ?? defaultPollDeadlineMilliseconds);
  const interval =
    input.pollIntervalMilliseconds ?? defaultPollIntervalMilliseconds;
  while (now() < deadline) {
    let alias: CanonicalAlias;
    try {
      alias = await resolveCanonicalAlias(
        input.token,
        input.projectId,
        input.teamId
      );
    } catch {
      await sleep(interval);
      continue;
    }
    if (aliasServesDeployment(alias, expected)) return true;
    await sleep(interval);
  }
  return false;
};

/**
 * Verifies that the canonical production alias serves the restored
 * deployment after a rollback. A rollback that the alias does not confirm is
 * a failed recovery.
 */
export const verifyCanonicalAliasServes = async (
  expectedUrl: string,
  input: {
    readonly token: string;
    readonly projectId: string;
    readonly teamId: string | undefined;
  } & PollingOptions,
  dependencies: PollingDependencies = {}
): Promise<void> => {
  const confirmed = await waitForCanonicalAlias(
    { id: null, url: expectedUrl },
    input,
    dependencies
  );
  if (!confirmed) {
    throw new Error(
      "Rollback verification failed: the canonical production alias does not serve the restored deployment"
    );
  }
};

export type PromotionInput = {
  readonly stagedUrl: string;
  readonly token: string;
  readonly projectId: string;
  readonly teamId: string | undefined;
} & PollingOptions;

export type PromotionDependencies = PollingDependencies & {
  readonly rollback?: (url: string) => Promise<void>;
};

/**
 * Promotes the staged production deployment so the outcome can never leave a
 * possibly promoted untested release behind:
 *
 * 1. The canonical alias is resolved before the request, giving the
 *    authoritative baseline for every later decision.
 * 2. The promotion request goes through the primary Vercel API, which
 *    classifies it without waiting: a 4xx answer is a definitive rejection
 *    before any change, while acceptance or an ambiguous failure may still
 *    complete server-side.
 * 3. The canonical alias is then polled within a bounded window; it is the
 *    only authority on whether the promotion took effect.
 * 4. When the window closes without an answer after a possibly-started
 *    promotion, the release rolls back to the baseline, verifies the alias,
 *    and fails — never exiting with production in an untested state.
 */
export const promoteStagedDeployment = async (
  input: PromotionInput,
  dependencies: PromotionDependencies = {}
): Promise<{ readonly promoted: boolean }> => {
  const staged = await resolveStagedDeployment(
    input.stagedUrl,
    input.token,
    input.teamId
  );
  if (staged.readyState !== "READY") {
    throw new Error(
      `The staged deployment is ${staged.readyState}, not READY; refusing to promote`
    );
  }

  const baseline = await resolveCanonicalAlias(
    input.token,
    input.projectId,
    input.teamId
  );
  if (
    aliasServesDeployment(baseline, { id: staged.id, url: input.stagedUrl })
  ) {
    return { promoted: true };
  }

  const requestOutcome = await requestPromotion(
    input.projectId,
    staged.id,
    input.token,
    input.teamId
  );
  if (requestOutcome === "rejected") {
    throw new Error(
      "Vercel rejected the promotion request; the previous deployment is still serving production"
    );
  }

  const promoted = await waitForCanonicalAlias(
    { id: staged.id, url: input.stagedUrl },
    input,
    dependencies
  );
  if (promoted) return { promoted: true };

  const recovery =
    dependencies.rollback ?? (async (url: string) => rollbackToDeployment(url));
  await recovery(baseline.deploymentUrl);
  const verified = await waitForCanonicalAlias(
    { id: baseline.deploymentId, url: baseline.deploymentUrl },
    input,
    dependencies
  );
  if (!verified) {
    throw new Error(
      "Rollback verification failed after an ambiguous promotion: the canonical production alias does not serve the baseline deployment"
    );
  }
  throw new Error(
    "The promotion outcome stayed ambiguous past the polling deadline, so production was rolled back to the baseline deployment and the release failed"
  );
};

const usage = (message?: string): never => {
  if (message) process.stderr.write(`${message}\n`);
  process.stderr.write(
    "Usage: production-release.ts <resolve-previous|probe|verify-canonical|verify-crons|promote|rollback> [--url <url>]\n"
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
    case "promote": {
      const outcome = await promoteStagedDeployment({
        stagedUrl: readUrlOption(),
        token: vercelToken,
        projectId,
        teamId,
      });
      await appendFile(
        requireEnv("GITHUB_OUTPUT"),
        `promoted=${outcome.promoted ? "true" : "false"}\n`
      );
      return;
    }
    case "rollback": {
      const url = readUrlOption();
      await rollbackToDeployment(url);
      await verifyCanonicalAliasServes(url, {
        token: vercelToken,
        projectId,
        teamId,
      });
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
