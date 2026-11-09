import { appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { $ } from "bun";
import { skippedSourceMapUploadMarker } from "./source-map-upload-failure";

export const findDeploymentUrl = (output: string) =>
  output.match(/https:\/\/[^\s]+\.vercel\.app/g)?.at(-1);

/**
 * GitHub warning annotations for a build that shipped without uploading its
 * source maps, so the release run shows it.
 */
export const skippedSourceMapUploadWarnings = (output: string) =>
  output.split("\n").flatMap((line) => {
    const markerAt = line.indexOf(skippedSourceMapUploadMarker);
    if (markerAt === -1) return [];
    const reason = line
      .slice(markerAt + skippedSourceMapUploadMarker.length)
      .trim()
      .replaceAll("%", "%25")
      .replaceAll("\r", "%0D");
    return [`::warning title=Source maps not uploaded to PostHog::${reason}\n`];
  });

const buildStagedProductionDeployment = async () => {
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (!githubOutput) {
    throw new Error("GITHUB_OUTPUT is not set");
  }

  const vercelToken = process.env.VERCEL_TOKEN;
  if (!vercelToken) {
    throw new Error("VERCEL_TOKEN is not set");
  }

  const deployment =
    await $`bunx vercel@54.9.1 deploy --prod --skip-domain --yes --archive=tgz --cwd . --token ${vercelToken}`
      .cwd(fileURLToPath(new URL("../../..", import.meta.url)))
      .quiet()
      .nothrow();
  const deploymentOutput = deployment.stdout.toString();
  process.stdout.write(deploymentOutput);
  process.stderr.write(deployment.stderr);
  for (const warning of skippedSourceMapUploadWarnings(
    `${deploymentOutput}\n${deployment.stderr.toString()}`
  )) {
    process.stdout.write(warning);
  }

  if (deployment.exitCode !== 0) {
    throw new Error(
      `Vercel deployment failed with exit code ${deployment.exitCode}`
    );
  }

  const deploymentUrl = findDeploymentUrl(deploymentOutput);
  if (!deploymentUrl) {
    throw new Error("Vercel did not return a deployment URL");
  }

  await appendFile(githubOutput, `url=${deploymentUrl}\n`);
};

if (import.meta.main) {
  buildStagedProductionDeployment().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  });
}
