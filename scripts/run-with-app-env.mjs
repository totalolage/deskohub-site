import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

function parseCliOptions(argv) {
  const separatorIndex = argv.indexOf("--");

  if (separatorIndex === -1) {
    throw new Error(
      'Missing command separator "--". Example: node scripts/run-with-app-env.mjs deskohub-boardgame-bar -- bunx next dev',
    );
  }

  const optionArgs = argv.slice(0, separatorIndex);
  const command = argv.slice(separatorIndex + 1);

  if (command.length === 0) {
    throw new Error("No command was provided after \"--\".");
  }

  let appIdentifier;
  let mode = "development";

  for (let index = 0; index < optionArgs.length; index += 1) {
    const currentArg = optionArgs[index];

    if (currentArg === "--mode") {
      const nextArg = optionArgs[index + 1];
      if (!nextArg) {
        throw new Error('Expected a mode value after "--mode".');
      }

      mode = nextArg;
      index += 1;
      continue;
    }

    if (!appIdentifier) {
      appIdentifier = currentArg;
      continue;
    }

    throw new Error(
      `Unexpected argument "${currentArg}". Supported options are: <app> [--mode <mode>] -- <command>`,
    );
  }

  if (!appIdentifier) {
    throw new Error("Missing app identifier. Example: deskohub-boardgame-bar");
  }

  return { appIdentifier, mode, command };
}

function resolveAppDirectory(repoRoot, appIdentifier) {
  const absoluteAppDirectory = appIdentifier.startsWith("apps/")
    ? resolve(repoRoot, appIdentifier)
    : resolve(repoRoot, "apps", appIdentifier);

  if (!existsSync(absoluteAppDirectory)) {
    throw new Error(`App directory does not exist: ${absoluteAppDirectory}`);
  }

  if (!statSync(absoluteAppDirectory).isDirectory()) {
    throw new Error(`App path is not a directory: ${absoluteAppDirectory}`);
  }

  return absoluteAppDirectory;
}

function parseEnvLine(line) {
  const trimmedLine = line.trim();

  if (!trimmedLine || trimmedLine.startsWith("#")) {
    return null;
  }

  const withoutExport = trimmedLine.startsWith("export ")
    ? trimmedLine.slice(7).trim()
    : trimmedLine;

  const equalsIndex = withoutExport.indexOf("=");
  if (equalsIndex === -1) {
    return null;
  }

  const key = withoutExport.slice(0, equalsIndex).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return null;
  }

  let rawValue = withoutExport.slice(equalsIndex + 1).trim();

  if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
    rawValue = rawValue.slice(1, -1);
    rawValue = rawValue
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\\\/g, "\\")
      .replace(/\\\"/g, '"');
  } else if (rawValue.startsWith("'") && rawValue.endsWith("'")) {
    rawValue = rawValue.slice(1, -1);
  } else {
    rawValue = rawValue.replace(/\s+#.*$/, "").trim();
  }

  return [key, rawValue];
}

function parseEnvFile(filePath) {
  const content = readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const parsedEntries = {};

  for (const line of lines) {
    const parsedLine = parseEnvLine(line);
    if (!parsedLine) {
      continue;
    }

    const [key, value] = parsedLine;
    parsedEntries[key] = value;
  }

  return parsedEntries;
}

function buildEnvFileList(repoRoot, appDirectory, mode) {
  const rootEnvFiles = [
    resolve(repoRoot, ".env"),
    resolve(repoRoot, ".env.local"),
    resolve(repoRoot, `.env.${mode}`),
    resolve(repoRoot, `.env.${mode}.local`),
  ];

  const appEnvFiles = [
    resolve(appDirectory, ".env"),
    resolve(appDirectory, ".env.local"),
    resolve(appDirectory, `.env.${mode}`),
    resolve(appDirectory, `.env.${mode}.local`),
  ];

  return [...rootEnvFiles, ...appEnvFiles];
}

async function main() {
  const repoRoot = resolve(import.meta.dirname, "..");
  const { appIdentifier, mode, command } = parseCliOptions(process.argv.slice(2));
  const appDirectory = resolveAppDirectory(repoRoot, appIdentifier);
  const orderedEnvFiles = buildEnvFileList(repoRoot, appDirectory, mode);

  const mergedFileEnv = {};
  const loadedFilePaths = [];

  for (const envFilePath of orderedEnvFiles) {
    if (!existsSync(envFilePath)) {
      continue;
    }

    Object.assign(mergedFileEnv, parseEnvFile(envFilePath));
    loadedFilePaths.push(envFilePath);
  }

  const finalEnvironment = {
    ...mergedFileEnv,
    ...process.env,
  };

  if (process.env.DEBUG_APP_ENV === "1") {
    const displayPaths = loadedFilePaths.length > 0 ? loadedFilePaths : ["<none>"];
    console.error(`[run-with-app-env] mode=${mode} app=${appIdentifier}`);
    console.error(`[run-with-app-env] loaded: ${displayPaths.join(", ")}`);
  }

  const [commandName, ...commandArgs] = command;

  const childProcess = spawn(commandName, commandArgs, {
    cwd: process.cwd(),
    env: finalEnvironment,
    stdio: "inherit",
  });

  const exitCode = await new Promise((resolvePromise, rejectPromise) => {
    childProcess.on("error", (error) => {
      rejectPromise(error);
    });

    childProcess.on("exit", (exitCode) => {
      resolvePromise(exitCode ?? 1);
    });
  });

  process.exit(exitCode);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[run-with-app-env] ${message}`);
  process.exit(1);
});
