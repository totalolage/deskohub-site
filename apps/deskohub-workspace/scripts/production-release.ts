import { appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { $ } from "bun";
import { Schema } from "effect";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";

const vercelApiOrigin = "https://api.vercel.com";

const workspaceProductionDomain = "deskohub-workspace-site.vercel.app";
const customerFacingProductionDomain = workspaceSiteConstants.brand.domain;
const requiredProductionAliases = [
  workspaceProductionDomain,
  customerFacingProductionDomain,
] as const;
const canonicalLandingPath = "/en-US";
const authSessionPath = "/api/auth/get-session";
const authSessionCacheControl = "private, no-store";
const landingPageHeadingMarker = 'id="landing-page-heading"';
const immutableWorkspaceDeploymentHost =
  /^deskohub-workspace(?:-site)?-[a-z0-9]{9}-[a-z0-9-]+\.vercel\.app$/;

const defaultPollDeadlineMilliseconds = 10 * 60_000;
const defaultPollIntervalMilliseconds = 15_000;

const requiredCronDefinitions = [
  {
    path: "/api/cron/workspace/reservation-holds",
    schedule: "0 0 * * *",
  },
  {
    path: "/api/cron/workspace/auth-cleanup",
    schedule: "17 3 * * *",
  },
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
  projectId: Schema.String,
  target: Schema.String,
  readyState: Schema.String,
  url: Schema.String,
  crons: Schema.Array(
    Schema.Struct({
      path: Schema.optional(Schema.String),
      schedule: Schema.optional(Schema.String),
    })
  ),
});

const liveProjectCronsResponse = Schema.Struct({
  id: Schema.String,
  crons: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        deploymentId: Schema.optional(Schema.NullOr(Schema.String)),
        definitions: Schema.optional(
          Schema.Array(
            Schema.Struct({
              path: Schema.optional(Schema.String),
              schedule: Schema.optional(Schema.String),
            })
          )
        ),
      })
    )
  ),
});

const projectAliasesPageResponse = Schema.Struct({
  aliases: Schema.Array(
    Schema.Struct({
      alias: Schema.String,
      deploymentId: Schema.optional(Schema.NullOr(Schema.String)),
      deployment: Schema.optional(
        Schema.NullOr(
          Schema.Struct({
            id: Schema.optional(Schema.NullOr(Schema.String)),
            url: Schema.optional(Schema.NullOr(Schema.String)),
          })
        )
      ),
    })
  ),
  pagination: Schema.Struct({
    next: Schema.NullOr(Schema.Number),
  }),
});

const requireEnv = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const vercelApiGet = async (
  pathWithQuery: string,
  token: string,
  signal?: AbortSignal
): Promise<unknown> => {
  const response = await fetch(`${vercelApiOrigin}${pathWithQuery}`, {
    headers: { authorization: `Bearer ${token}` },
    signal,
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

export type AuthSessionReadyOptions = {
  /** Explicit Vercel protection bypass for a validated staged deployment. */
  readonly deploymentProtectionBypassSecret?: string;
};

const validateStagedDeploymentUrl = (baseUrl: string): URL => {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("Staged deployment URL must be a valid URL");
  }
  if (url.protocol !== "https:") {
    throw new Error("Staged deployment URL must use HTTPS");
  }
  if (!url.hostname.endsWith(".vercel.app")) {
    throw new Error("Staged deployment URL must use a Vercel deployment host");
  }
  if (!immutableWorkspaceDeploymentHost.test(url.hostname)) {
    throw new Error(
      "Staged deployment URL must be an immutable Vercel deployment URL"
    );
  }
  if (
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Staged deployment URL must be an origin without credentials, a port, a path, a query, or a hash"
    );
  }
  return url;
};

/**
 * Anonymous Better Auth readiness probe: the deployment must answer an
 * unauthenticated session request with a healthy null session marked
 * private/no-store. An explicit bypass is accepted only for a validated
 * immutable staged deployment, never from ambient environment state. Never
 * sends a magic link and never reads a token.
 */
export const assertAuthSessionReady = async (
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
  options: AuthSessionReadyOptions = {}
) => {
  const bypassSecret = options.deploymentProtectionBypassSecret;
  const base =
    bypassSecret === undefined
      ? new URL(baseUrl)
      : validateStagedDeploymentUrl(baseUrl);
  const sessionUrl = new URL(authSessionPath, base);
  const response =
    bypassSecret === undefined
      ? await fetchImpl(sessionUrl)
      : await fetchImpl(sessionUrl, {
          headers: { "x-vercel-protection-bypass": bypassSecret },
          redirect: "error",
        });
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
 * Production smoke against the customer-facing host: the anonymous session
 * endpoint and public landing page must both be healthy on the domain
 * customers actually use. The landing page is independent of account rollout
 * state; delivery is proven by the exact-SHA preview E2E.
 */
export const assertCanonicalLandingReady = async (
  fetchImpl: typeof fetch = fetch
) => {
  const base = `https://${customerFacingProductionDomain}`;
  await assertAuthSessionReady(base, fetchImpl);
  const response = await fetchImpl(new URL(canonicalLandingPath, base), {
    redirect: "error",
  });
  if (response.status !== 200) {
    throw new Error(
      `Canonical landing page probe failed with ${response.status}`
    );
  }
  if (!(await response.text()).includes(landingPageHeadingMarker)) {
    throw new Error(
      "Canonical landing page did not render the landing-page heading"
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

const missingCronDefinition = (
  definitions:
    | readonly {
        readonly path?: string;
        readonly schedule?: string;
      }[]
    | undefined
) =>
  requiredCronDefinitions.find(
    (required) =>
      !definitions?.some(
        (definition) =>
          definition.path === required.path &&
          definition.schedule === required.schedule
      )
  );

const assertRequiredCronDefinitions = (
  definitions:
    | readonly {
        readonly path?: string;
        readonly schedule?: string;
      }[]
    | undefined,
  subject: string
) => {
  const missing = missingCronDefinition(definitions);
  if (missing) {
    throw new Error(
      `${subject} is missing the required cron definition ${missing.path} (${missing.schedule})`
    );
  }
};

export const assertStagedDeploymentCrons = async (
  stagedUrl: string,
  projectId: string,
  token: string,
  teamId: string | undefined
): Promise<void> => {
  const validatedUrl = validateStagedDeploymentUrl(stagedUrl);
  await resolveStagedDeployment(
    validatedUrl.toString(),
    projectId,
    token,
    teamId
  );
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
  projectId: string,
  token: string,
  teamId: string | undefined
): Promise<{ readonly id: string }> => {
  const host = urlHostName(stagedUrl);
  const payload = Schema.decodeUnknownSync(stagedDeploymentResponse)(
    await vercelApiGet(
      `/v13/deployments/${encodeURIComponent(host)}${vercelApiQuery({
        teamId,
      })}`,
      token
    )
  );
  if (payload.projectId !== projectId) {
    throw new Error(
      `The staged deployment belongs to a different Vercel project (${payload.projectId} instead of ${projectId})`
    );
  }
  if (payload.target !== "production") {
    throw new Error(
      `The staged deployment target is ${payload.target}, not production`
    );
  }
  if (payload.readyState !== "READY") {
    throw new Error(
      `The staged deployment is ${payload.readyState}, not READY; refusing to promote`
    );
  }
  if (payload.url !== host) {
    throw new Error(
      "The staged deployment lookup returned a different deployment URL"
    );
  }
  if (!/^[A-Za-z0-9_-]+$/.test(payload.id)) {
    throw new Error("The staged deployment returned an invalid deployment id");
  }
  assertRequiredCronDefinitions(payload.crons, "The staged deployment");
  return { id: payload.id };
};

export const assertLiveProjectCrons = async (
  promotedDeploymentId: string,
  input: {
    readonly token: string;
    readonly projectId: string;
    readonly teamId: string | undefined;
  } & PollingOptions,
  dependencies: PollingDependencies = {}
): Promise<void> => {
  if (!/^[A-Za-z0-9_-]+$/.test(promotedDeploymentId)) {
    throw new Error("The promoted deployment id is invalid");
  }

  const { sleep, now } = makePolling(dependencies);
  const deadline =
    now() + (input.pollDeadlineMilliseconds ?? defaultPollDeadlineMilliseconds);
  const interval =
    input.pollIntervalMilliseconds ?? defaultPollIntervalMilliseconds;
  let lastCondition = "the live cron configuration has not converged";

  while (now() < deadline) {
    const remaining = deadline - now();
    const abortController = new AbortController();
    const deadlineTimer = (dependencies.deadlineTimer ?? createDeadlineTimer)(
      remaining
    );
    const request = vercelApiGet(
      `/v9/projects/${encodeURIComponent(input.projectId)}${vercelApiQuery({
        teamId: input.teamId,
      })}`,
      input.token,
      abortController.signal
    )
      .then((response) =>
        Schema.decodeUnknownSync(liveProjectCronsResponse)(response)
      )
      .then(
        (payload) => ({ kind: "response", payload }) as const,
        () => ({ kind: "unavailable" }) as const
      );
    const attempt = await Promise.race([
      request,
      deadlineTimer.promise.then(() => ({ kind: "deadline" }) as const),
    ]).finally(() => deadlineTimer.cancel());

    if (attempt.kind === "deadline") {
      abortController.abort();
      lastCondition =
        "the Vercel project cron response did not complete before the deadline";
      break;
    }
    if (now() >= deadline) {
      abortController.abort();
      lastCondition =
        "the Vercel project cron response completed after the deadline";
      break;
    }
    if (attempt.kind === "unavailable") {
      lastCondition = "the Vercel project cron response was unavailable";
    } else {
      const payload = attempt.payload;
      if (payload.id !== input.projectId) {
        throw new Error(
          `Live cron verification returned a different Vercel project (${payload.id} instead of ${input.projectId})`
        );
      }

      const crons = payload.crons ?? undefined;
      if (crons?.deploymentId !== promotedDeploymentId) {
        lastCondition = `the live cron configuration still identifies deployment ${crons?.deploymentId ?? "unknown"}`;
      } else {
        const missing = missingCronDefinition(crons.definitions);
        if (!missing) return;
        lastCondition = `the live cron configuration is missing ${missing.path} (${missing.schedule})`;
      }
    }

    const remainingAfterRequest = deadline - now();
    if (remainingAfterRequest <= 0) break;
    await sleep(Math.min(interval, remainingAfterRequest));
  }

  throw new Error(
    `Live workspace cron verification did not converge before the deadline: ${lastCondition}`
  );
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
  readonly deadlineTimer?: (ms: number) => PollingDeadlineTimer;
};

export type PollingDeadlineTimer = {
  readonly promise: Promise<void>;
  readonly cancel: () => void;
};

const createDeadlineTimer = (milliseconds: number): PollingDeadlineTimer => {
  let timer: ReturnType<typeof setTimeout>;
  const promise = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, milliseconds);
  });
  return { promise, cancel: () => clearTimeout(timer) };
};

const makePolling = ({ sleep, now }: PollingDependencies = {}) => ({
  sleep: sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms))),
  now: now ?? (() => Date.now()),
});

/**
 * Verifies that every required production alias — the project alias and the
 * customer-facing custom domain — serves the restored deployment after a
 * rollback. The restored deployment is matched by its id first, so alias
 * rows that carry a deploymentId without a nested deployment url still
 * confirm. A rollback that any required alias does not confirm is a failed
 * recovery.
 */
export const verifyCanonicalAliasServes = async (
  expected: ProductionRollbackTarget,
  input: {
    readonly token: string;
    readonly projectId: string;
    readonly teamId: string | undefined;
  } & PollingOptions,
  dependencies: PollingDependencies = {}
): Promise<void> => {
  const confirmed = await waitForProductionAliases(
    expected,
    input,
    dependencies
  );
  if (!confirmed) {
    throw new Error(
      "Rollback verification failed: the required production aliases do not all serve the restored deployment"
    );
  }
};

type ProjectAliasRow = {
  readonly alias: string;
  readonly deploymentId: string | null;
  readonly deploymentUrl: string | null;
};

/**
 * Lists every alias of the configured Vercel project, following the Vercel
 * pagination cursor (`pagination.next` becomes the `until` timestamp of the
 * next page) until the listing is exhausted, so a required production alias
 * can never be missed just because it sits on a later page.
 */
const listProjectAliases = async (
  token: string,
  projectId: string,
  teamId: string | undefined
): Promise<ProjectAliasRow[]> => {
  const rows: ProjectAliasRow[] = [];
  let until: number | undefined;
  for (let page = 0; page < 100; page++) {
    const payload = Schema.decodeUnknownSync(projectAliasesPageResponse)(
      await vercelApiGet(
        `/v4/aliases${vercelApiQuery({
          projectId,
          teamId,
          limit: "100",
          until: until === undefined ? undefined : String(until),
        })}`,
        token
      )
    );
    rows.push(
      ...payload.aliases.map((row) => ({
        alias: row.alias,
        deploymentId: row.deploymentId ?? null,
        deploymentUrl: row.deployment?.url ?? null,
      }))
    );
    const next = payload.pagination.next;
    if (next === null) return rows;
    until = next;
  }
  throw new Error("Vercel alias pagination did not terminate");
};

/**
 * Bounded authoritative poll across every required production alias
 * (the project alias and the customer-facing custom domain), shared by
 * promotion confirmation and rollback verification. Each alias is
 * classified separately: an alias still serving another deployment is
 * pending, while an alias missing from the fully paginated project listing
 * can never serve this release and fails the promotion immediately.
 */
const waitForProductionAliases = async (
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
    let aliases: ProjectAliasRow[];
    try {
      aliases = await listProjectAliases(
        input.token,
        input.projectId,
        input.teamId
      );
    } catch {
      await sleep(interval);
      continue;
    }
    const missing = requiredProductionAliases.filter(
      (alias) => !aliases.some((row) => row.alias === alias)
    );
    if (missing.length > 0) {
      throw new Error(
        `Production aliases are missing from the Vercel project and can never serve this release: ${missing.join(", ")}`
      );
    }
    const unconfirmed = requiredProductionAliases.filter((alias) => {
      const row = aliases.find((candidate) => candidate.alias === alias);
      return (
        !row ||
        !aliasServesDeployment(
          {
            deploymentId: row.deploymentId,
            deploymentUrl: row.deploymentUrl ?? "",
            projectId: input.projectId,
          },
          expected
        )
      );
    });
    if (unconfirmed.length === 0) return true;
    await sleep(interval);
  }
  return false;
};

export type PromotionInput = {
  readonly stagedUrl: string;
  readonly token: string;
  readonly projectId: string;
  readonly teamId: string | undefined;
} & PollingOptions;

export type PromotionDependencies = PollingDependencies & {
  readonly rollback?: (url: string) => Promise<void>;
  readonly persist?: (output: string) => Promise<void>;
};

const persistReleaseOutput = async (output: string) => {
  await appendFile(requireEnv("GITHUB_OUTPUT"), output);
};

/**
 * Promotes the staged production deployment so the outcome can never leave a
 * possibly promoted untested release behind:
 *
 * 1. The canonical alias is resolved immediately before the request; that
 *    authoritative baseline's url and deployment id, plus a "promotion
 *    possibly started" state, are persisted through GITHUB_OUTPUT before any
 *    side effect, so the workflow finalizer can always recover, even after
 *    a crash.
 * 2. The promotion request goes through the primary Vercel API, which
 *    classifies it without waiting: a 4xx answer is a definitive rejection
 *    before any change, while acceptance or an ambiguous failure may still
 *    complete server-side.
 * 3. Every required production alias — the project alias and the
 *    customer-facing custom domain — is then polled within a bounded
 *    window; only terminal per-alias success declares the promotion done.
 * 4. When the window closes without an answer after a possibly-started
 *    promotion, the release rolls back to the baseline, verifies every
 *    required production alias serves it, and fails — never exiting with
 *    production in an untested state. A rollback or verification failure
 *    persists "recovery-needed" so the workflow's always() finalizer
 *    restores and re-verifies the baseline.
 */
export const promoteStagedDeployment = async (
  input: PromotionInput,
  dependencies: PromotionDependencies = {}
): Promise<{ readonly promoted: boolean }> => {
  const persist = dependencies.persist ?? persistReleaseOutput;
  const staged = await resolveStagedDeployment(
    input.stagedUrl,
    input.projectId,
    input.token,
    input.teamId
  );

  const baseline = await resolveCanonicalAlias(
    input.token,
    input.projectId,
    input.teamId
  );
  process.stdout.write(`::add-mask::${baseline.deploymentUrl}\n`);
  if (baseline.deploymentId) {
    process.stdout.write(`::add-mask::${baseline.deploymentId}\n`);
  }
  await persist(
    `baseline_url=${baseline.deploymentUrl}\nbaseline_id=${baseline.deploymentId ?? ""}\n`
  );

  let pollingFailure: unknown;
  if (
    !aliasServesDeployment(baseline, { id: staged.id, url: input.stagedUrl })
  ) {
    await persist("promotion_state=possibly-started\n");
    const requestOutcome = await requestPromotion(
      input.projectId,
      staged.id,
      input.token,
      input.teamId
    );
    if (requestOutcome === "rejected") {
      await persist("promotion_state=rejected\n");
      throw new Error(
        "Vercel rejected the promotion request; the previous deployment is still serving production"
      );
    }
  }

  let promoted: boolean;
  try {
    promoted = await waitForProductionAliases(
      { id: staged.id, url: input.stagedUrl },
      input,
      dependencies
    );
  } catch (cause) {
    promoted = false;
    pollingFailure = cause;
  }
  if (promoted) {
    process.stdout.write(`::add-mask::${staged.id}\n`);
    await persist(
      `promoted=true\npromoted_id=${staged.id}\npromotion_state=promoted\n`
    );
    return { promoted: true };
  }

  const recovery =
    dependencies.rollback ?? (async (url: string) => rollbackToDeployment(url));
  try {
    await recovery(baseline.deploymentUrl);
    const verified = await waitForProductionAliases(
      { id: baseline.deploymentId, url: baseline.deploymentUrl },
      input,
      dependencies
    );
    if (!verified) {
      throw new Error(
        "Rollback verification failed after an ambiguous promotion: the required production aliases do not all serve the baseline deployment"
      );
    }
    await persist("promotion_state=restored\n");
  } catch (cause) {
    await persist("promotion_state=recovery-needed\n");
    throw cause instanceof Error ? cause : new Error(String(cause));
  }
  throw pollingFailure instanceof Error
    ? pollingFailure
    : new Error(
        pollingFailure
          ? String(pollingFailure)
          : "The promotion outcome stayed ambiguous past the polling deadline, so production was rolled back to the baseline deployment and the release failed"
      );
};

const usage = (message?: string): never => {
  if (message) process.stderr.write(`${message}\n`);
  process.stderr.write(
    "Usage: production-release.ts <resolve-previous|probe|verify-staged-crons|verify-canonical|promote|rollback> [--url <url>] [--id <id>]\n"
  );
  process.exit(1);
};

const readOptionValue = (option: string): string | undefined => {
  const index = process.argv.indexOf(option);
  const value = index === -1 ? undefined : process.argv[index + 1];
  return value ? value : undefined;
};

const readUrlOption = (): string =>
  readOptionValue("--url") ?? usage("--url is required");

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
      await assertAuthSessionReady(readUrlOption(), fetch, {
        deploymentProtectionBypassSecret: requireEnv(
          "VERCEL_AUTOMATION_BYPASS_SECRET"
        ),
      });
      return;
    }
    case "verify-canonical": {
      const promotedDeploymentId =
        readOptionValue("--id") ?? usage("--id is required");
      await assertCanonicalLandingReady();
      await assertLiveProjectCrons(promotedDeploymentId, {
        token: vercelToken,
        projectId,
        teamId,
      });
      return;
    }
    case "verify-staged-crons": {
      await assertStagedDeploymentCrons(
        readUrlOption(),
        projectId,
        vercelToken,
        teamId
      );
      return;
    }
    case "promote": {
      await promoteStagedDeployment({
        stagedUrl: readUrlOption(),
        token: vercelToken,
        projectId,
        teamId,
      });
      return;
    }
    case "rollback": {
      const url = readUrlOption();
      const id = readOptionValue("--id");
      await rollbackToDeployment(url);
      await verifyCanonicalAliasServes(
        { id: id ?? null, url },
        {
          token: vercelToken,
          projectId,
          teamId,
        }
      );
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
