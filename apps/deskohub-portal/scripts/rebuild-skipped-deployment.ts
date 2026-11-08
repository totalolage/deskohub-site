/**
 * Builds a portal deployment that Vercel skipped although the portal changed.
 *
 * Vercel skips the portal when a commit doesn't affect it relative to its
 * parent. A push of several commits, or a parent whose deployment failed or
 * was canceled, can leave a portal change undeployed. This compares the
 * skipped commit with the last ready portal deployment of the same
 * repository, branch and target (for a preview without one, production's)
 * and, unless every change since then is in a package the portal doesn't
 * depend on, builds it: a preview by redeploying the skipped deployment, and
 * production by deploying the branch's current head, so recovery never
 * promotes an older commit.
 *
 * Run by `.github/workflows/portal-skipped-deployments.yml`. `DRY_RUN=1`
 * reports the decision without deploying.
 */
import { $ } from "bun";

const vercelApiOrigin = "https://api.vercel.com";
const portalPackageName = "deskohub-portal";

export type Decision = {
  readonly rebuild: boolean;
  readonly reason: string;
};

type PackageGraph = {
  /** Directory of every workspace package, relative to the repository root. */
  readonly packagePaths: readonly string[];
  /** Directories of the portal and the workspace packages it depends on. */
  readonly portalPackagePaths: readonly string[];
};

const owningPackagePath = (
  path: string,
  packagePaths: readonly string[]
): string | undefined =>
  packagePaths
    .filter((packagePath) => path.startsWith(`${packagePath}/`))
    .sort((left, right) => right.length - left.length)[0];

/** Why a changed file can reach the portal's install or build, if it can. */
export const portalInputReason = (
  path: string,
  graph: PackageGraph
): string | undefined => {
  if (path === "bun.lock" || path.split("/").at(-1) === "package.json") {
    return `${path} can change the shared install`;
  }
  const packagePath = owningPackagePath(path, graph.packagePaths);
  if (packagePath === undefined) {
    return `${path} is outside every workspace package`;
  }
  if (graph.portalPackagePaths.includes(packagePath)) {
    return `${path} is in a package the portal builds from`;
  }
  return undefined;
};

export const decideRebuild = (
  changedPaths: readonly string[],
  graph: PackageGraph
): Decision => {
  for (const path of changedPaths) {
    const reason = portalInputReason(path, graph);
    if (reason) return { rebuild: true, reason };
  }
  return {
    rebuild: false,
    reason: `none of ${changedPaths.length} changed files reach the portal`,
  };
};

export type DeploymentSummary = {
  readonly id: string;
  readonly created: number;
  readonly readyState: string;
  readonly target: string | null;
  readonly repositoryId: string | undefined;
  readonly ref: string | undefined;
  readonly sha: string | undefined;
};

/** Whether two deployments come from the same repository, branch and target. */
const sameSource = (left: DeploymentSummary, right: DeploymentSummary) =>
  left.repositoryId === right.repositoryId &&
  left.ref === right.ref &&
  (left.target ?? "preview") === (right.target ?? "preview");

/**
 * The deployment to compare with: the newest ready one of the same source
 * created before the skipped one, or else the newest ready production
 * deployment of the repository.
 */
export const comparisonBase = (
  skipped: DeploymentSummary,
  deployments: readonly DeploymentSummary[]
): DeploymentSummary | undefined => {
  const ready = deployments
    .filter(
      (deployment) =>
        deployment.readyState === "READY" &&
        deployment.created < skipped.created &&
        deployment.sha !== undefined &&
        deployment.repositoryId === skipped.repositoryId
    )
    .sort((left, right) => right.created - left.created);

  return (
    ready.find((deployment) => sameSource(deployment, skipped)) ??
    ready.find((deployment) => deployment.target === "production")
  );
};

/** Whether a newer deployment of the same source makes the skipped one obsolete. */
export const isSuperseded = (
  skipped: DeploymentSummary,
  deployments: readonly DeploymentSummary[]
) =>
  deployments.some(
    (deployment) =>
      sameSource(deployment, skipped) && deployment.created > skipped.created
  );

/** Whether a deployment is one Vercel skipped (it cancels skipped ones). */
export const isRecoverableSkip = (deployment: DeploymentSummary) =>
  deployment.readyState === "CANCELED";

export type PortalDeployments = {
  /** Deployments for a list query; `truncated` when more pages exist. */
  readonly list: (query: Record<string, string>) => Promise<{
    readonly deployments: readonly DeploymentSummary[];
    readonly truncated: boolean;
  }>;
  /** Redeploys a deployment, which builds it again. */
  readonly redeploy: (deploymentId: string) => Promise<DeploymentSummary>;
  /** Deploys the current head of a branch to production. */
  readonly deployBranchHeadToProduction: (input: {
    readonly repositoryId: string;
    readonly ref: string;
  }) => Promise<DeploymentSummary>;
};

export type RecoveryOutcome =
  | { readonly action: "none"; readonly reason: string }
  | {
      readonly action: "deployed";
      readonly reason: string;
      readonly deploymentId: string;
    };

export const recoverSkippedDeployment = async ({
  skipped,
  deployments,
  decide,
  dryRun,
}: {
  readonly skipped: DeploymentSummary;
  readonly deployments: PortalDeployments;
  readonly decide: (
    head: string,
    base: DeploymentSummary | undefined
  ) => Promise<Decision>;
  readonly dryRun: boolean;
}): Promise<RecoveryOutcome> => {
  const { ref, repositoryId, sha } = skipped;
  if (!ref || !sha || !repositoryId) {
    throw new Error("The skipped deployment has no Git commit");
  }
  if (!isRecoverableSkip(skipped)) {
    return {
      action: "none",
      reason: `${skipped.id} is ${skipped.readyState}, not skipped`,
    };
  }

  const superseded = async () => {
    const newer = await deployments.list({
      branch: ref,
      since: String(skipped.created),
      limit: "100",
    });
    return newer.truncated || isSuperseded(skipped, newer.deployments);
  };
  if (await superseded()) {
    return {
      action: "none",
      reason: `${skipped.id} is superseded by a newer ${ref} deployment`,
    };
  }

  const until = String(skipped.created);
  const ready = [
    ...(
      await deployments.list({
        branch: ref,
        state: "READY",
        until,
        limit: "20",
      })
    ).deployments,
    ...(
      await deployments.list({
        target: "production",
        state: "READY",
        until,
        limit: "20",
      })
    ).deployments,
  ];
  const base = comparisonBase(skipped, ready);
  const decision = await decide(sha, base);
  const reason = `${skipped.id} (${sha}) against ${base?.id ?? "nothing"}: ${decision.reason}`;
  if (!decision.rebuild || dryRun) return { action: "none", reason };
  if (await superseded()) {
    return {
      action: "none",
      reason: `${skipped.id} was superseded while comparing`,
    };
  }

  const deployed =
    skipped.target === "production"
      ? await deployments.deployBranchHeadToProduction({ repositoryId, ref })
      : await deployments.redeploy(skipped.id);
  return { action: "deployed", reason, deploymentId: deployed.id };
};

/** Files changed between two commits, or `undefined` if Git can't tell. */
export const changedPathsBetween = async (
  base: string,
  head: string,
  cwd: string
): Promise<readonly string[] | undefined> => {
  const result =
    await $`git -c core.quotePath=false diff --no-relative --no-renames --no-ext-diff --ignore-submodules=none --name-only -z ${base} ${head}`
      .cwd(cwd)
      .quiet()
      .nothrow();
  if (result.exitCode !== 0) return undefined;
  return result.stdout.toString().split("\0").filter(Boolean);
};

const turboPackagePaths = async (cwd: string, filter?: string) => {
  const output =
    (await $`bun turbo ls ${filter ? [`--filter=${filter}`] : []} --output=json`
      .cwd(cwd)
      .quiet()
      .json()) as { packages: { items: { path: string }[] } };
  return output.packages.items.map(({ path }) => path);
};

export const readPackageGraph = async (cwd: string): Promise<PackageGraph> => ({
  packagePaths: await turboPackagePaths(cwd),
  portalPackagePaths: await turboPackagePaths(cwd, `${portalPackageName}...`),
});

const report = (line: string) => process.stdout.write(`${line}\n`);

const requireEnv = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

type VercelDeployment = {
  uid?: string;
  id?: string;
  created?: number;
  createdAt?: number;
  readyState?: string;
  state?: string;
  target?: string | null;
  projectId?: string;
  meta?: {
    githubCommitRef?: string;
    githubCommitRepoId?: string;
    githubCommitSha?: string;
  };
};

type DeploymentList = {
  deployments: VercelDeployment[];
  pagination?: { next?: number | null };
};

const summarize = (deployment: VercelDeployment): DeploymentSummary => {
  const id = deployment.uid ?? deployment.id;
  const created = deployment.created ?? deployment.createdAt;
  if (!id || created === undefined) {
    throw new Error("Vercel returned a deployment without an id or time");
  }
  return {
    id,
    created,
    readyState: deployment.readyState ?? deployment.state ?? "UNKNOWN",
    target: deployment.target ?? null,
    repositoryId: deployment.meta?.githubCommitRepoId,
    ref: deployment.meta?.githubCommitRef,
    sha: deployment.meta?.githubCommitSha,
  };
};

const vercelApi = async (
  path: string,
  token: string,
  init?: { method: "POST"; body: unknown }
): Promise<unknown> => {
  const response = await fetch(`${vercelApiOrigin}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      authorization: `Bearer ${token}`,
      ...(init && { "content-type": "application/json" }),
    },
    ...(init && { body: JSON.stringify(init.body) }),
  });
  if (!response.ok) {
    throw new Error(
      `Vercel API ${init?.method ?? "GET"} ${path.split("?")[0]} failed with ${response.status}`
    );
  }
  return response.json();
};

const decideAgainst = async (
  head: string,
  base: DeploymentSummary | undefined,
  repositoryRoot: string
): Promise<Decision> => {
  if (base?.sha === undefined) {
    return {
      rebuild: true,
      reason: "no ready portal deployment to compare with",
    };
  }
  const changedPaths = await changedPathsBetween(
    base.sha,
    head,
    repositoryRoot
  );
  if (changedPaths === undefined) {
    return { rebuild: true, reason: `cannot compare with ${base.sha}` };
  }
  const graph = await readPackageGraph(repositoryRoot).catch(() => undefined);
  if (graph === undefined) {
    return { rebuild: true, reason: "cannot read the package graph" };
  }
  return decideRebuild(changedPaths, graph);
};

const main = async () => {
  const token = requireEnv("VERCEL_TOKEN");
  const teamId = requireEnv("VERCEL_TEAM_ID");
  const projectId = requireEnv("PORTAL_PROJECT_ID");
  const skippedUrl = process.env.SKIPPED_DEPLOYMENT_URL;
  const skippedSha = process.env.SKIPPED_DEPLOYMENT_SHA;
  const repositoryRoot = (await $`git rev-parse --show-toplevel`.text()).trim();

  const deployments: PortalDeployments = {
    list: async (query) => {
      const list = (await vercelApi(
        `/v6/deployments?${new URLSearchParams({ projectId, teamId, ...query })}`,
        token
      )) as DeploymentList;
      return {
        deployments: list.deployments.map(summarize),
        truncated: Boolean(list.pagination?.next),
      };
    },
    redeploy: async (deploymentId) =>
      summarize(
        (await vercelApi(
          `/v13/deployments?teamId=${teamId}&forceNew=1`,
          token,
          {
            method: "POST",
            body: { name: portalPackageName, deploymentId },
          }
        )) as VercelDeployment
      ),
    deployBranchHeadToProduction: async ({ repositoryId, ref }) =>
      summarize(
        (await vercelApi(
          `/v13/deployments?teamId=${teamId}&forceNew=1`,
          token,
          {
            method: "POST",
            body: {
              name: portalPackageName,
              project: projectId,
              target: "production",
              gitSource: { type: "github", repoId: repositoryId, ref },
            },
          }
        )) as VercelDeployment
      ),
  };

  const skippedDeployment = skippedUrl
    ? ((await vercelApi(
        `/v13/deployments/${encodeURIComponent(
          new URL(
            skippedUrl.includes("://") ? skippedUrl : `https://${skippedUrl}`
          ).host
        )}?teamId=${teamId}`,
        token
      )) as VercelDeployment)
    : undefined;
  if (skippedDeployment && skippedDeployment.projectId !== projectId) {
    throw new Error("The skipped deployment belongs to another project");
  }
  const skipped = skippedDeployment
    ? summarize(skippedDeployment)
    : (
        await deployments.list({
          limit: "20",
          sha: requireEnv("SKIPPED_DEPLOYMENT_SHA"),
        })
      ).deployments.find((deployment) => deployment.sha === skippedSha);
  if (!skipped) {
    throw new Error("No portal deployment matches the skipped commit");
  }

  const outcome = await recoverSkippedDeployment({
    skipped,
    deployments,
    decide: (head, base) => decideAgainst(head, base, repositoryRoot),
    dryRun: process.env.DRY_RUN === "1",
  });
  report(
    outcome.action === "deployed"
      ? `${outcome.reason}; deploying as ${outcome.deploymentId}`
      : outcome.reason
  );
};

if (import.meta.main) await main();
