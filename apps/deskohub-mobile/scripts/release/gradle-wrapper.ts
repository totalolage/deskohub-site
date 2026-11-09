// Makes the Gradle downloads of a CI APK build survive a slow or failing
// services.gradle.org or Maven host. The Gradle wrapper fetches its
// distribution once with a 10 s timeout and no retry; `prepareGradle`
// downloads it first, with retries and a fallback source, into the directory
// the wrapper looks in, so the wrapper only unpacks it. It also raises
// Gradle's own retries and HTTP timeouts for dependency downloads in the
// Gradle user home's gradle.properties.

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

// Where Gradle publishes the zip's SHA-256: a .sha256 file, or the digest
// GitHub lists for the release asset of that name.
export type ChecksumSource =
  | { readonly kind: "file"; readonly url: string }
  | {
      readonly asset: string;
      readonly kind: "github-asset";
      readonly url: string;
    };

// The places to download the distribution zip and its SHA-256 from, in the
// order to try them; distributionUrl comes first.
export type DistributionSources = {
  readonly checksums: readonly ChecksumSource[];
  readonly zips: readonly string[];
};

export type WrapperDistribution = {
  // The wrapper writes this after unpacking; with it the wrapper downloads
  // nothing.
  readonly markerPath: string;
  readonly sha256: string | undefined;
  readonly sources: DistributionSources;
  readonly url: string;
  readonly zipPath: string;
};

const property = (properties: string, name: string): string | undefined =>
  new RegExp(`^${name}=(.*)$`, "m")
    .exec(properties)?.[1]
    ?.trim()
    .replaceAll("\\:", ":");

// GitHub's tag for a Gradle version, as services.gradle.org's redirects name
// it: 8.10 is v8.10.0, 9.9.0-rc-1 is v9.9.0-RC1, 9.9.0-milestone-1 is
// v9.9.0-M1.
const githubReleaseTag = (version: string): string | undefined => {
  const match = /^(\d+\.\d+)(\.\d+)?(?:-(rc|milestone)-(\d+))?$/.exec(version);
  if (match === null) {
    return undefined;
  }
  const [, minor, patch = ".0", stage, number] = match;
  const suffix =
    stage === undefined ? "" : `-${stage === "rc" ? "RC" : "M"}${number}`;
  return `v${minor}${patch}${suffix}`;
};

// Where to fetch the distribution that distributionUrl names. For a release
// on services.gradle.org, which redirects its zip to Gradle's GitHub release
// and its .sha256 to downloads.gradle.org, those serve the same files when
// services.gradle.org fails. The GitHub release has no .sha256 files, but
// GitHub's API lists each asset's SHA-256.
export const distributionSources = (url: string): DistributionSources => {
  const official = {
    checksums: [{ kind: "file", url: `${url}.sha256` }],
    zips: [url],
  } as const;
  const parsed = new URL(url);
  const fileName = parsed.pathname.split("/").at(-1) ?? "";
  const version = /^gradle-(.+)-(?:bin|all)\.zip$/.exec(fileName)?.[1];
  const tag = version === undefined ? undefined : githubReleaseTag(version);
  if (
    parsed.host !== "services.gradle.org" ||
    parsed.pathname !== `/distributions/${fileName}` ||
    tag === undefined
  ) {
    return official;
  }
  return {
    checksums: [
      ...official.checksums,
      {
        kind: "file",
        url: `https://downloads.gradle.org/distributions/${fileName}.sha256`,
      },
      {
        asset: fileName,
        kind: "github-asset",
        url: `https://api.github.com/repos/gradle/gradle-distributions/releases/tags/${tag}`,
      },
    ],
    zips: [
      ...official.zips,
      `https://github.com/gradle/gradle-distributions/releases/download/${tag}/${fileName}`,
    ],
  };
};

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
    sources: distributionSources(url),
    url,
    zipPath: join(directory, fileName),
  };
};

// "quick" for a source with another one after it, so a failing host hands
// over within about a minute; "patient" for the last one.
export type DownloadEffort = "quick" | "patient";

export type Download = (
  url: string,
  path: string,
  effort: DownloadEffort
) => Promise<void>;

// How hard curl tries one source, in seconds. `deadline` bounds the whole
// download, retries included: curl's --retry-max-time only stops it from
// starting a retry, and --max-time bounds one attempt.
const curlLimits = {
  patient: { connectTimeout: 30, deadline: 300, retries: 8, retryDelay: 5 },
  quick: { connectTimeout: 10, deadline: 60, retries: 2, retryDelay: 2 },
} as const satisfies Record<
  DownloadEffort,
  {
    readonly connectTimeout: number;
    readonly deadline: number;
    readonly retries: number;
    readonly retryDelay: number;
  }
>;

// curl retries a timeout, a reset connection and any HTTP error, which a 504
// from services.gradle.org or its GitHub-hosted redirect target needs. On
// failure it prints the redirect hop that failed, without the query string
// that signs GitHub's asset URLs.
export const curlDownload: Download = async (url, path, effort) => {
  const limits = curlLimits[effort];
  const child = Bun.spawn(
    [
      "curl",
      "--fail",
      "--silent",
      "--show-error",
      "--location",
      "--retry",
      String(limits.retries),
      "--retry-all-errors",
      "--retry-delay",
      String(limits.retryDelay),
      "--retry-max-time",
      String(limits.deadline),
      "--connect-timeout",
      String(limits.connectTimeout),
      "--max-time",
      String(limits.deadline),
      "--write-out",
      "%{onerror}curl: the last request went to %{urle.scheme}://%{urle.host}%{urle.path} (HTTP %{http_code})\n",
      "--output",
      path,
      url,
    ],
    {
      killSignal: "SIGKILL",
      stderr: "inherit",
      stdin: "ignore",
      stdout: "inherit",
      timeout: limits.deadline * 1000,
    }
  );
  const exitCode = await child.exited;
  if (child.signalCode !== null) {
    throw new Error(
      `curl gave up on ${url} after the ${limits.deadline} s deadline.`
    );
  }
  if (exitCode !== 0) {
    throw new Error(`curl could not download ${url} (exit ${exitCode}).`);
  }
};

export type Prefetch =
  | { readonly result: "installed" }
  | {
      // undefined when distributionSha256Sum pins the checksum.
      readonly checksumUrl: string | undefined;
      readonly result: "downloaded";
      // Each source that failed before one answered, with its error.
      readonly skipped: readonly string[];
      readonly zipUrl: string;
    };

const sha256Pattern = /^[0-9a-f]{64}$/i;

// The SHA-256 a downloaded checksum source states.
const readChecksum = (source: ChecksumSource, path: string): string => {
  const text = readFileSync(path, "utf8").trim();
  const checksum =
    source.kind === "file"
      ? text
      : (
          JSON.parse(text) as {
            readonly assets?: readonly {
              readonly digest?: string | null;
              readonly name?: string;
            }[];
          }
        ).assets
          ?.find((asset) => asset.name === source.asset)
          ?.digest?.replace(/^sha256:/, "");
  if (checksum === undefined || !sha256Pattern.test(checksum)) {
    throw new Error(`${source.url} states no SHA-256 for the distribution.`);
  }
  return checksum;
};

// Downloads the distribution to the wrapper's zip path unless the wrapper
// already has it, and checks it against distributionSha256Sum or the
// SHA-256 Gradle publishes. Each file comes from the first source that
// answers; a host that failed once isn't asked again. A checksum mismatch
// fails at once: it is a wrong file, not an outage.
export const prefetchWrapperDistribution = async (
  distribution: WrapperDistribution,
  download: Download = curlDownload
): Promise<Prefetch> => {
  if (existsSync(distribution.markerPath) || existsSync(distribution.zipPath)) {
    return { result: "installed" };
  }
  mkdirSync(dirname(distribution.zipPath), { recursive: true });
  const partPath = `${distribution.zipPath}.prefetch`;
  const checksumPath = `${partPath}.sha256`;
  const failures: string[] = [];
  const failedHosts = new Set<string>();
  const fromFirstSource = async <Source, Result>(
    sources: readonly Source[],
    urlOf: (source: Source) => string,
    fetch: (source: Source, effort: DownloadEffort) => Promise<Result>
  ): Promise<{ readonly result: Result; readonly url: string }> => {
    const candidates = sources.filter(
      (source) => !failedHosts.has(new URL(urlOf(source)).host)
    );
    for (const [index, source] of candidates.entries()) {
      const url = urlOf(source);
      try {
        const effort = index < candidates.length - 1 ? "quick" : "patient";
        return { result: await fetch(source, effort), url };
      } catch (error) {
        failedHosts.add(new URL(url).host);
        failures.push(
          `${url}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    throw new Error(
      `Could not download the Gradle distribution from any source:\n${failures.join("\n")}`
    );
  };
  try {
    let expected = distribution.sha256;
    let checksumUrl: string | undefined;
    if (expected === undefined) {
      const checksum = await fromFirstSource(
        distribution.sources.checksums,
        (source) => source.url,
        async (source, effort) => {
          await download(source.url, checksumPath, effort);
          return readChecksum(source, checksumPath);
        }
      );
      expected = checksum.result;
      checksumUrl = checksum.url;
    }
    const { url: zipUrl } = await fromFirstSource(
      distribution.sources.zips,
      (url) => url,
      (url, effort) => download(url, partPath, effort)
    );
    const actual = createHash("sha256")
      .update(readFileSync(partPath))
      .digest("hex");
    if (actual !== expected.toLowerCase()) {
      throw new Error(`${zipUrl} has SHA-256 ${actual}, expected ${expected}.`);
    }
    renameSync(partPath, distribution.zipPath);
    return { checksumUrl, result: "downloaded", skipped: failures, zipUrl };
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
  readonly prefetch: Prefetch;
}> => {
  const distribution = wrapperDistribution(
    input.wrapperProperties,
    input.gradleUserHome
  );
  const prefetch = await prefetchWrapperDistribution(
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
  return { distribution, prefetch };
};
