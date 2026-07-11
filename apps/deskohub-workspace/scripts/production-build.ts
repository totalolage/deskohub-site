import { appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

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

  const deployment = Bun.spawn(
    [
      "bunx",
      "vercel@54.9.1",
      "deploy",
      "--prod",
      "--skip-domain",
      "--yes",
      "--archive=tgz",
      "--cwd",
      ".",
      "--token",
      vercelToken,
    ],
    {
      cwd: fileURLToPath(new URL("../../..", import.meta.url)),
      env: process.env,
      stdout: "pipe",
      stderr: "inherit",
    }
  );

  const deploymentOutput = await new Response(deployment.stdout).text();
  const exitCode = await deployment.exited;
  process.stdout.write(deploymentOutput);

  if (exitCode !== 0) {
    throw new Error(`Vercel deployment failed with exit code ${exitCode}`);
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
