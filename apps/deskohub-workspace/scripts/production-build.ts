import { appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { $ } from "bun";

export const findDeploymentUrl = (output: string) =>
  output.match(/https:\/\/[^\s]+\.vercel\.app/g)?.at(-1);

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
