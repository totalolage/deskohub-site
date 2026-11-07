/**
 * Stands in for the Expo CLI in publish-mobile-update CLI tests: the tests
 * put `expo` and `expo-updates` shims that run this file into a fixture
 * project's `node_modules/.bin`. `expo export` copies the fixture export to
 * `--output-dir`, `expo config` prints a public config, and `expo-updates
 * runtimeversion:resolve` prints `fixture-runtime-<platform>`. Each call is
 * appended as a JSON line to `PUBLISH_FIXTURE_RECORD`.
 */
import { appendFileSync, cpSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [, , cli = "", ...args] = process.argv;
const recordFile = process.env.PUBLISH_FIXTURE_RECORD;
if (recordFile) {
  appendFileSync(
    recordFile,
    `${JSON.stringify({ kind: "expo", cli, args, cwd: process.cwd() })}\n`
  );
}

const option = (name: string) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

const fixtureExport = fileURLToPath(
  new URL("../features/mobile-updates/publish/fixtures/export", import.meta.url)
);

if (cli === "expo" && args[0] === "export") {
  const outputDirectory = option("--output-dir");
  if (!outputDirectory) throw new Error("expo export needs --output-dir");
  cpSync(fixtureExport, outputDirectory, { recursive: true });
} else if (cli === "expo" && args[0] === "config") {
  process.stdout.write(
    JSON.stringify({ name: "Synthetic", slug: "synthetic", version: "1.0.0" })
  );
} else if (cli === "expo-updates" && args[0] === "runtimeversion:resolve") {
  process.stdout.write(
    JSON.stringify({
      runtimeVersion: `fixture-runtime-${option("--platform")}`,
      fingerprintSources: [],
      workflow: "managed",
    })
  );
} else {
  process.stderr.write(`Unexpected Expo CLI call: ${cli} ${args.join(" ")}\n`);
  process.exit(1);
}
