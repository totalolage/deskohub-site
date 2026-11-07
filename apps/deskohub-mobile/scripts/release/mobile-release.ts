// Builds the release-signed Android APK the same way in GitHub Actions
// (.github/workflows/mobile-release.yml) and on a developer machine.
//
//   bun scripts/release/mobile-release.ts metadata [--tag mobile-vX.Y.Z]
//   bun scripts/release/mobile-release.ts build [--tag mobile-vX.Y.Z] [--signing release|debug] --out-dir <dir>
//
// `metadata` prints `key=value` lines for $GITHUB_OUTPUT. With --tag, both
// commands fail unless the tag matches `expo.version` in app.json and
// CHANGELOG.md has a section for it. `build` needs EXPO_TOKEN; it writes
// deskohub-<version>.apk and release-notes.md to the output directory after
// checking the APK signature. `--signing release` (the default) needs
// ANDROID_KEYSTORE_PASSWORD and ANDROID_KEYSTORE_BASE64 or
// ANDROID_KEYSTORE_PATH, and checks that the release certificate signed the
// APK. `--signing debug` is for pull request dry runs: it signs with a
// throwaway key that keytool generates for the build, never reads the release
// keystore, and checks that the release certificate did not sign the APK.

import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { androidVersionCode } from "../../app.config";
import { verifyApkIdentity } from "./apk-badging";
import {
  formatCertificateSha256,
  verifyNonReleaseSigners,
  verifyReleaseSigners,
} from "./apk-signature";
import { changelogSection, renderReleaseNotes } from "./release-notes";
import { releaseTag, releaseTagVersion } from "./release-tag";

const projectDirectory = resolve(import.meta.dir, "../..");

const signingModes = ["release", "debug"] as const;
type Signing = (typeof signingModes)[number];

type SigningKey = { readonly alias: string; readonly password: string };

const print = (line: string) => {
  process.stdout.write(`${line}\n`);
};

type ReleaseMetadata = {
  readonly apkFileName: string;
  readonly changelog: string | undefined;
  readonly packageName: string;
  readonly tag: string;
  readonly version: string;
  readonly versionCode: number;
};

const readJson = async <T>(path: string): Promise<T> =>
  (await Bun.file(join(projectDirectory, path)).json()) as T;

const releaseMetadata = async (
  tag: string | undefined
): Promise<ReleaseMetadata> => {
  const { expo } = await readJson<{
    expo: { android: { package: string }; version: string };
  }>("app.json");
  const version = expo.version;
  const changelog = changelogSection(
    await Bun.file(join(projectDirectory, "CHANGELOG.md")).text(),
    version
  );
  if (tag !== undefined) {
    const tagVersion = releaseTagVersion(tag);
    if (tagVersion !== version) {
      throw new Error(
        `Tag ${tag} does not match expo.version ${version} in apps/deskohub-mobile/app.json. Bump the version on main before tagging.`
      );
    }
    if (changelog === undefined) {
      throw new Error(
        `apps/deskohub-mobile/CHANGELOG.md has no "## [${version}]" section.`
      );
    }
  }
  return {
    apkFileName: `deskohub-${version}.apk`,
    changelog,
    packageName: expo.android.package,
    tag: releaseTag(version),
    version,
    versionCode: androidVersionCode(version),
  };
};

const requiredEnvironment = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set.`);
  }
  return value;
};

const run = async (
  command: readonly string[],
  options: { readonly capture?: boolean; readonly env?: Record<string, string> }
): Promise<string> => {
  const child = Bun.spawn([...command], {
    cwd: projectDirectory,
    env: { ...process.env, ...options.env },
    stderr: "inherit",
    stdin: "ignore",
    stdout: options.capture === true ? "pipe" : "inherit",
  });
  const output =
    options.capture === true ? await new Response(child.stdout).text() : "";
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`${command.join(" ")} exited with ${exitCode}.`);
  }
  return output;
};

// Writes the release keystore from the environment to keystorePath.
const writeReleaseKeystore = async (
  keystorePath: string
): Promise<SigningKey> => {
  const password = requiredEnvironment("ANDROID_KEYSTORE_PASSWORD");
  const keystoreBase64 = process.env.ANDROID_KEYSTORE_BASE64;
  const keystore =
    keystoreBase64 === undefined || keystoreBase64 === ""
      ? await Bun.file(
          requiredEnvironment("ANDROID_KEYSTORE_PATH")
        ).arrayBuffer()
      : Buffer.from(keystoreBase64, "base64");
  writeFileSync(keystorePath, new Uint8Array(keystore), { mode: 0o600 });
  return { alias: "deskohub-workspace", password };
};

// Generates a throwaway key at keystorePath. The password reaches keytool
// through the environment, so a failed command line never shows it.
const generateDebugKeystore = async (
  keystorePath: string
): Promise<SigningKey> => {
  const password = randomBytes(24).toString("base64url");
  const javaHome = process.env.JAVA_HOME;
  await run(
    [
      javaHome === undefined ? "keytool" : join(javaHome, "bin", "keytool"),
      "-genkeypair",
      "-noprompt",
      "-keystore",
      keystorePath,
      "-storetype",
      "PKCS12",
      "-alias",
      "deskohub-dry-run",
      "-keyalg",
      "RSA",
      "-keysize",
      "2048",
      "-validity",
      "30",
      "-dname",
      "CN=Deskohub dry run",
      "-storepass:env",
      "DEBUG_KEYSTORE_PASSWORD",
      "-keypass:env",
      "DEBUG_KEYSTORE_PASSWORD",
    ],
    { capture: true, env: { DEBUG_KEYSTORE_PASSWORD: password } }
  );
  return { alias: "deskohub-dry-run", password };
};

// Writes the keystore and credentials.json that `credentialsSource: local`
// reads, runs `use`, and removes both whatever happens.
const withSigningCredentials = async (
  signing: Signing,
  use: () => Promise<void>
) => {
  const credentialsPath = join(projectDirectory, "credentials.json");
  let createdCredentials = false;
  const signingDirectory = mkdtempSync(
    join(tmpdir(), "deskohub-mobile-signing-")
  );
  try {
    const keystorePath = join(signingDirectory, `${signing}.keystore`);
    const { alias, password } =
      signing === "release"
        ? await writeReleaseKeystore(keystorePath)
        : await generateDebugKeystore(keystorePath);
    writeFileSync(
      credentialsPath,
      JSON.stringify({
        android: {
          keystore: {
            keyAlias: alias,
            keyPassword: password,
            keystorePassword: password,
            keystorePath,
          },
        },
      }),
      // Exclusive create: an existing credentials.json belongs to someone
      // else and must neither sign this build nor be deleted by it.
      { flag: "wx", mode: 0o600 }
    );
    createdCredentials = true;
    chmodSync(credentialsPath, 0o600);
    await use();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(
        `${credentialsPath} already exists; remove it so the build signs with the ${signing} keystore.`
      );
    }
    throw error;
  } finally {
    if (createdCredentials) {
      rmSync(credentialsPath, { force: true });
    }
    rmSync(signingDirectory, { force: true, recursive: true });
  }
};

// The newest Android SDK build-tools directory that has the tool.
const buildToolPath = (tool: "aapt2" | "apksigner"): string => {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (sdk === undefined) {
    throw new Error(`Set ANDROID_HOME to find ${tool}.`);
  }
  const buildTools = readdirSync(join(sdk, "build-tools"))
    .filter((version) => existsSync(join(sdk, "build-tools", version, tool)))
    .sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true })
    )
    .at(-1);
  if (buildTools === undefined) {
    throw new Error(`No ${tool} under ${join(sdk, "build-tools")}.`);
  }
  return join(sdk, "build-tools", buildTools, tool);
};

const sha256File = async (path: string): Promise<string> =>
  new Bun.CryptoHasher("sha256")
    .update(await Bun.file(path).arrayBuffer())
    .digest("hex");

const build = async (
  tag: string | undefined,
  signing: Signing,
  outDirectory: string
) => {
  const metadata = await releaseMetadata(tag);
  requiredEnvironment("EXPO_TOKEN");
  const { cli } = await readJson<{ cli: { version: string } }>("eas.json");
  const output = resolve(outDirectory);
  mkdirSync(output, { recursive: true });
  const apkPath = join(output, metadata.apkFileName);
  rmSync(apkPath, { force: true });

  await withSigningCredentials(signing, () =>
    run(
      [
        "bunx",
        `eas-cli@${cli.version}`,
        "build",
        "--platform",
        "android",
        "--profile",
        "production",
        "--local",
        "--non-interactive",
        "--output",
        apkPath,
      ],
      {
        env: {
          // A Gradle daemon outlives the build and has been killed on shared
          // machines mid-build; one build per run gains nothing from it.
          GRADLE_OPTS:
            process.env.GRADLE_OPTS ??
            "-Dorg.gradle.daemon=false -Dorg.gradle.workers.max=4",
        },
      }
    ).then(() => undefined)
  );

  const badging = await run(
    [buildToolPath("aapt2"), "dump", "badging", apkPath],
    { capture: true }
  );
  const identity = verifyApkIdentity(badging, {
    packageName: metadata.packageName,
    versionCode: metadata.versionCode,
    versionName: metadata.version,
  });
  print(
    `APK package: ${identity.packageName} ${identity.versionName} (version code ${identity.versionCode})`
  );
  const apksignerOutput = await run(
    [
      buildToolPath("apksigner"),
      "verify",
      "--print-certs",
      "--verbose",
      apkPath,
    ],
    { capture: true }
  );
  process.stdout.write(apksignerOutput);
  const [certificateSha256] =
    signing === "release"
      ? verifyReleaseSigners(apksignerOutput)
      : verifyNonReleaseSigners(apksignerOutput);
  if (certificateSha256 === undefined) {
    throw new Error("apksigner reported no signer certificates.");
  }
  const apkSha256 = await sha256File(apkPath);
  writeFileSync(
    join(output, "release-notes.md"),
    renderReleaseNotes({ ...metadata, apkSha256, certificateSha256 })
  );
  print(`APK: ${apkPath}`);
  print(`APK SHA-256: ${apkSha256}`);
  print(
    `Signing certificate SHA-256: ${formatCertificateSha256(certificateSha256)} (${signing === "release" ? "matches the release certificate" : "throwaway debug key, not the release certificate"})`
  );
};

const main = async () => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      "out-dir": { type: "string" },
      signing: { default: "release", type: "string" },
      tag: { type: "string" },
    },
  });
  const tag = values.tag === "" ? undefined : values.tag;
  switch (positionals[0]) {
    case "metadata": {
      const metadata = await releaseMetadata(tag);
      print(`version=${metadata.version}`);
      print(`version-code=${metadata.versionCode}`);
      print(`apk-name=${metadata.apkFileName}`);
      print(`tag=${metadata.tag}`);
      return;
    }
    case "build": {
      const outDirectory = values["out-dir"];
      if (outDirectory === undefined) {
        throw new Error("build needs --out-dir.");
      }
      const signing = signingModes.find((mode) => mode === values.signing);
      if (signing === undefined) {
        throw new Error(
          `--signing must be one of ${signingModes.join(", ")}, not ${JSON.stringify(values.signing)}.`
        );
      }
      if (signing === "debug" && tag !== undefined) {
        throw new Error(
          "A release tag builds with the release key; --signing debug is for untagged dry runs."
        );
      }
      await build(tag, signing, outDirectory);
      return;
    }
    default:
      throw new Error(
        "Usage: mobile-release.ts metadata|build [--tag mobile-vX.Y.Z] [--signing release|debug] [--out-dir <dir>]"
      );
  }
};

await main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
});
