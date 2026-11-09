// Makes the Gradle downloads of a CI APK build survive a slow or failing
// services.gradle.org or Maven host. The Gradle wrapper fetches its
// distribution once with a 10 s timeout and no retry; `prepareGradle`
// downloads it first, with retries, into the directory the wrapper looks in,
// so the wrapper only unpacks it. It also raises Gradle's own retries and HTTP
// timeouts for dependency downloads in the Gradle user home's
// gradle.properties.

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export type WrapperDistribution = {
  // The wrapper writes this after unpacking; with it the wrapper downloads
  // nothing.
  readonly markerPath: string;
  readonly sha256: string | undefined;
  readonly url: string;
  readonly zipPath: string;
};

const property = (properties: string, name: string): string | undefined =>
  new RegExp(`^${name}=(.*)$`, "m")
    .exec(properties)?.[1]
    ?.trim()
    .replaceAll("\\:", ":");

// Where the wrapper of these gradle-wrapper.properties keeps its distribution
// zip: <base>/<zipStorePath>/<name>/<base36 MD5 of the URL>/<name>.zip, as
// Gradle's PathAssembler names it.
export const wrapperDistribution = (
  properties: string,
  gradleUserHome: string
): WrapperDistribution => {
  const url = property(properties, "distributionUrl");
  if (url === undefined) {
    throw new Error("gradle-wrapper.properties has no distributionUrl.");
  }
  for (const base of ["distributionBase", "zipStoreBase"]) {
    const value = property(properties, base) ?? "GRADLE_USER_HOME";
    if (value !== "GRADLE_USER_HOME") {
      throw new Error(
        `${base}=${value} is not supported; expected GRADLE_USER_HOME.`
      );
    }
  }
  if (
    (property(properties, "distributionPath") ?? "wrapper/dists") !==
    (property(properties, "zipStorePath") ?? "wrapper/dists")
  ) {
    throw new Error("distributionPath and zipStorePath differ.");
  }
  const parsed = new URL(url);
  parsed.username = "";
  parsed.password = "";
  const fileName = parsed.pathname.split("/").at(-1) ?? "";
  if (!fileName.endsWith(".zip")) {
    throw new Error(`distributionUrl ${url} does not name a .zip.`);
  }
  const hash = BigInt(
    `0x${createHash("md5").update(parsed.toString()).digest("hex")}`
  ).toString(36);
  const directory = join(
    gradleUserHome,
    property(properties, "zipStorePath") ?? "wrapper/dists",
    fileName.slice(0, -".zip".length),
    hash
  );
  return {
    markerPath: join(directory, `${fileName}.ok`),
    sha256: property(properties, "distributionSha256Sum"),
    url,
    zipPath: join(directory, fileName),
  };
};

export type Download = (url: string, path: string) => Promise<void>;

// curl retries a timeout, a reset connection and any HTTP error, which a 504
// from the GitHub-hosted redirect target needs.
export const curlDownload: Download = async (url, path) => {
  const child = Bun.spawn(
    [
      "curl",
      "--fail",
      "--silent",
      "--show-error",
      "--location",
      "--retry",
      "8",
      "--retry-all-errors",
      "--retry-delay",
      "5",
      "--connect-timeout",
      "30",
      "--max-time",
      "300",
      "--output",
      path,
      url,
    ],
    { stderr: "inherit", stdin: "ignore", stdout: "inherit" }
  );
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`curl could not download ${url} (exit ${exitCode}).`);
  }
};

// Downloads the distribution to the wrapper's zip path unless the wrapper
// already has it, and checks it against distributionSha256Sum or the .sha256
// file Gradle publishes beside it.
export const prefetchWrapperDistribution = async (
  distribution: WrapperDistribution,
  download: Download = curlDownload
): Promise<"installed" | "downloaded"> => {
  if (existsSync(distribution.markerPath) || existsSync(distribution.zipPath)) {
    return "installed";
  }
  mkdirSync(dirname(distribution.zipPath), { recursive: true });
  const partPath = `${distribution.zipPath}.prefetch`;
  const checksumPath = `${partPath}.sha256`;
  try {
    let expected = distribution.sha256;
    if (expected === undefined) {
      await download(`${distribution.url}.sha256`, checksumPath);
      expected = readFileSync(checksumPath, "utf8").trim();
    }
    await download(distribution.url, partPath);
    const actual = createHash("sha256")
      .update(readFileSync(partPath))
      .digest("hex");
    if (actual !== expected.toLowerCase()) {
      throw new Error(
        `${distribution.url} has SHA-256 ${actual}, expected ${expected}.`
      );
    }
    renameSync(partPath, distribution.zipPath);
    return "downloaded";
  } finally {
    rmSync(partPath, { force: true });
    rmSync(checksumPath, { force: true });
  }
};

// Gradle makes three attempts (max.tentatives) at a dependency download that
// fails with a transient error or a 5xx answer, backing off from 1 s, and
// gives up on a read after 30 s. These make six attempts from 2 s and wait
// longer. Gradle 9 reads exactly these names; an unknown one is ignored.
export const gradleNetworkProperties = {
  "systemProp.org.gradle.internal.http.connectionTimeout": "60000",
  "systemProp.org.gradle.internal.http.socketTimeout": "120000",
  "systemProp.org.gradle.internal.repository.initial.backoff": "2000",
  "systemProp.org.gradle.internal.repository.max.tentatives": "6",
} as const;

// Appends the entries whose keys the gradle.properties text doesn't set yet.
export const withGradleProperties = (
  existing: string,
  entries: Readonly<Record<string, string>>
): string => {
  const keys = new Set(
    existing
      .split("\n")
      .map((line) => /^\s*([^#!=:\s][^=:\s]*)\s*[=:]/.exec(line)?.[1])
      .filter((key) => key !== undefined)
  );
  const missing = Object.entries(entries)
    .filter(([key]) => !keys.has(key))
    .map(([key, value]) => `${key}=${value}\n`);
  if (missing.length === 0) {
    return existing;
  }
  const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
  return `${existing}${separator}${missing.join("")}`;
};

export const prepareGradle = async (input: {
  readonly download?: Download;
  readonly gradleUserHome: string;
  readonly wrapperProperties: string;
}): Promise<{
  readonly distribution: WrapperDistribution;
  readonly result: "installed" | "downloaded";
}> => {
  const distribution = wrapperDistribution(
    input.wrapperProperties,
    input.gradleUserHome
  );
  const result = await prefetchWrapperDistribution(
    distribution,
    input.download
  );
  const propertiesPath = join(input.gradleUserHome, "gradle.properties");
  const existing = existsSync(propertiesPath)
    ? readFileSync(propertiesPath, "utf8")
    : "";
  const updated = withGradleProperties(existing, gradleNetworkProperties);
  if (updated !== existing) {
    writeFileSync(propertiesPath, updated);
  }
  return { distribution, result };
};
