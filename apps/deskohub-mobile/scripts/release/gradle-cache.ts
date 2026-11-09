// The key mobile-release.yml's pull request dry runs cache the Gradle user
// home under (~/.gradle/caches and ~/.gradle/wrapper), so a rerun doesn't
// download the Gradle distribution, the Kotlin compiler and every Android
// dependency again.
//
// The key names the Gradle distribution the Expo prebuild's wrapper uses and a
// hash of the inputs that decide what Gradle downloads: the whole wrapper
// properties, the app config, eas.json, the local config plugins and native modules, and
// the bun.lock versions of the Expo and React Native packages, which carry the
// autolinked native code. Other bun.lock changes leave the key alone.

import { join, resolve } from "node:path";

const projectDirectory = resolve(import.meta.dir, "../..");
const repositoryDirectory = resolve(projectDirectory, "../..");

// The prebuild copies its android/ project from the template in the installed
// `expo` package. Expo falls back to the npm template of the same SDK when the
// package has none; the key refuses that case instead of guessing, and
// gradle-cache.test.ts fails on an Expo upgrade that drops the template.
const templateWrapperProperties =
  "package/android/gradle/wrapper/gradle-wrapper.properties";

const nativeInputFiles = [
  "app.json",
  "app.config.ts",
  "eas.json",
  "plugins/**",
  "modules/*/expo-module.config.json",
  "modules/*/android/**",
];

// Expo and React Native packages, including scoped ones such as
// @react-native-async-storage/async-storage.
const nativePackageName =
  /^(expo|expo-.+|@expo\/.+|react-native|react-native-.+|@react-native(-[^/]+)?\/.+)$/;

export type NativeInputFile = {
  readonly content: Uint8Array | string;
  readonly path: string;
};

// "gradle-9.4.1-bin" from the wrapper's distributionUrl.
export const gradleDistributionName = (wrapperProperties: string): string => {
  const url = /^distributionUrl=(.+)$/m.exec(wrapperProperties)?.[1]?.trim();
  const name = url?.replaceAll("\\:", ":").split("/").at(-1);
  if (name === undefined || !name.endsWith(".zip")) {
    throw new Error(
      "gradle-wrapper.properties has no distributionUrl ending in .zip."
    );
  }
  return name.slice(0, -".zip".length);
};

// The sorted `name@version` resolutions of the Expo and React Native packages
// in bun.lock, however deeply bun.lock nests them.
export const nativePackageVersions = (lockfile: string): string[] => {
  const { packages } = Bun.JSONC.parse(lockfile) as {
    packages: Record<string, readonly unknown[]>;
  };
  const versions = new Set<string>();
  for (const [resolution] of Object.values(packages)) {
    if (typeof resolution !== "string") {
      continue;
    }
    const name = resolution.slice(0, resolution.lastIndexOf("@"));
    if (nativePackageName.test(name)) {
      versions.add(resolution);
    }
  }
  return [...versions].sort();
};

export const nativeInputsHash = (inputs: {
  readonly files: readonly NativeInputFile[];
  readonly packageVersions: readonly string[];
  readonly wrapperProperties: string;
}): string => {
  const hasher = new Bun.CryptoHasher("sha256");
  const sha256 = (content: Uint8Array | string) =>
    new Bun.CryptoHasher("sha256").update(content).digest("hex");
  const files = [...inputs.files].sort((left, right) =>
    left.path.localeCompare(right.path)
  );
  hasher.update(
    JSON.stringify({
      files: files.map((file) => [file.path, sha256(file.content)]),
      packages: inputs.packageVersions,
      wrapper: inputs.wrapperProperties,
    })
  );
  return hasher.digest("hex");
};

const readNativeInputFiles = async (): Promise<NativeInputFile[]> => {
  const paths = new Set<string>();
  for (const pattern of nativeInputFiles) {
    for await (const path of new Bun.Glob(pattern).scan({
      cwd: projectDirectory,
      onlyFiles: true,
    })) {
      if (!path.endsWith(".test.ts")) {
        paths.add(path);
      }
    }
  }
  return Promise.all(
    [...paths].map(async (path) => ({
      content: await Bun.file(join(projectDirectory, path)).bytes(),
      path,
    }))
  );
};

// The gradle-wrapper.properties the prebuild writes to android/gradle/wrapper.
export const readTemplateWrapperProperties = (): string => {
  const expoPackage = Bun.resolveSync("expo/package.json", projectDirectory);
  const template = join(expoPackage, "..", "template.tgz");
  const tar = Bun.spawnSync(
    ["tar", "-xzOf", template, templateWrapperProperties],
    { stderr: "pipe", stdout: "pipe" }
  );
  if (tar.exitCode !== 0) {
    throw new Error(
      `Could not read ${templateWrapperProperties} from ${template}: ${tar.stderr.toString().trim()}`
    );
  }
  return tar.stdout.toString();
};

export const gradleCacheKey = async (): Promise<{
  readonly gradle: string;
  readonly nativeInputs: string;
}> => {
  const wrapperProperties = readTemplateWrapperProperties();
  return {
    gradle: gradleDistributionName(wrapperProperties),
    nativeInputs: nativeInputsHash({
      files: await readNativeInputFiles(),
      packageVersions: nativePackageVersions(
        await Bun.file(join(repositoryDirectory, "bun.lock")).text()
      ),
      wrapperProperties,
    }),
  };
};
