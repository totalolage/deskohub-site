import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { WorkspaceE2EConfig } from "./config";
import { assert, log, repoRoot } from "./runtime";

export const writeVercelProjectLink = async (config: WorkspaceE2EConfig) => {
  const file = resolve(repoRoot, ".vercel/project.json");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(
    file,
    `${JSON.stringify({ orgId: config.vercelTeamId, projectId: config.vercelProjectId }, null, 2)}\n`
  );
};

export const getDeployment = async (
  config: WorkspaceE2EConfig,
  previewUrl: string
) => {
  const host = new URL(previewUrl).host;
  const response = await vercelFetch(config, `/v13/deployments/${host}`);
  const body = (await response.json()) as { id?: unknown };
  assert(
    typeof body.id === "string",
    "Vercel deployment response did not include id"
  );
  log(`Fresh Vercel deployment ${body.id} at ${previewUrl}`);
  return { id: body.id as string };
};

export const recordAliasPreflight = async (
  config: WorkspaceE2EConfig,
  deploymentId: string
) => {
  const response = await vercelFetch(
    config,
    `/v13/deployments/${config.alias}`,
    {},
    { allowFailure: true }
  );
  if (!response.ok) {
    log(`${config.alias} currently has no readable deployment target`);
    return true;
  }

  const body = (await response.json()) as { id?: unknown };
  if (body.id === deploymentId) {
    log(`${config.alias} already points at the fresh deployment`);
    return false;
  }

  if (typeof body.id === "string") {
    log(
      `${config.alias} currently points at ${body.id}; it will be left on the fresh deployment for webhook stability`
    );
  }
  return true;
};

export const assignAlias = async (
  config: WorkspaceE2EConfig,
  deploymentId: string
) => {
  const response = await vercelFetch(
    config,
    `/v2/deployments/${deploymentId}/aliases`,
    {
      body: JSON.stringify({ alias: config.alias }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }
  );
  if (!response.ok)
    throw new Error(`Vercel alias assignment failed: ${response.status}`);
  log(`Assigned ${config.aliasUrl} to fresh deployment`);
};

export const verifyAlias = async (
  config: WorkspaceE2EConfig,
  deploymentId: string
) => {
  const response = await vercelFetch(
    config,
    `/v13/deployments/${config.alias}`
  );
  const body = (await response.json()) as { id?: unknown };
  assert(
    body.id === deploymentId,
    `${config.alias} does not point at fresh deployment`
  );
  log("Vercel alias target verified");
};

export const assertWebhookEndpoint = async (
  config: WorkspaceE2EConfig,
  path: string
) => {
  const url = new URL(path, config.aliasUrl);
  if (config.bypassSecret)
    url.searchParams.set("x-vercel-protection-bypass", config.bypassSecret);

  const response = await fetch(url);
  assert(response.ok, `${path} health check failed with ${response.status}`);
};

const vercelFetch = async (
  config: WorkspaceE2EConfig,
  path: string,
  init: RequestInit = {},
  options: { readonly allowFailure?: boolean } = {}
) => {
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(
    `https://api.vercel.com${path}${separator}teamId=${config.vercelTeamId}`,
    {
      ...init,
      headers: {
        authorization: `Bearer ${config.vercelToken}`,
        ...init.headers,
      },
    }
  );
  if (!response.ok && !options.allowFailure)
    throw new Error(`Vercel API ${path} failed with ${response.status}`);
  return response;
};
