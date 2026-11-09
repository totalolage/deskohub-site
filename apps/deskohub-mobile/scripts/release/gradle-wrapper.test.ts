import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  type Download,
  distributionSources,
  gradleNetworkProperties,
  prepareGradle,
  withGradleProperties,
  wrapperDistribution,
} from "./gradle-wrapper";

const properties = `distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\\://services.gradle.org/distributions/gradle-9.4.1-bin.zip
networkTimeout=10000
validateDistributionUrl=true
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
`;

const homes: string[] = [];
const gradleHome = () => {
  const home = mkdtempSync(join(tmpdir(), "gradle-wrapper-test-"));
  homes.push(home);
  return home;
};
afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

const zip = Buffer.from("distribution bytes");
const zipSha256 = createHash("sha256").update(zip).digest("hex");

// Serves the distribution and its .sha256 file, recording each request.
const fakeDownload = (files: Record<string, Buffer | string>) => {
  const requests: string[] = [];
  const efforts: string[] = [];
  const download: Download = async (url, path, effort) => {
    requests.push(url);
    efforts.push(`${effort} ${url}`);
    const body = files[url];
    if (body === undefined) {
      throw new Error(`404 ${url}`);
    }
    writeFileSync(path, body);
  };
  return { download, efforts, requests };
};

const distributionUrl =
  "https://services.gradle.org/distributions/gradle-9.4.1-bin.zip";
const mirrorUrl =
  "https://github.com/gradle/gradle-distributions/releases/download/v9.4.1/gradle-9.4.1-bin.zip";
const mirrorChecksumUrl =
  "https://downloads.gradle.org/distributions/gradle-9.4.1-bin.zip.sha256";
const githubReleaseUrl =
  "https://api.github.com/repos/gradle/gradle-distributions/releases/tags/v9.4.1";
// The part of GitHub's release answer the digest comes from.
const githubRelease = JSON.stringify({
  assets: [
    { digest: `sha256:${"0".repeat(64)}`, name: "gradle-9.4.1-all.zip" },
    { digest: `sha256:${zipSha256}`, name: "gradle-9.4.1-bin.zip" },
  ],
});

describe("wrapperDistribution", () => {
  test("names the zip where Gradle's wrapper looks for it", () => {
    // The directory a real wrapper created for this URL.
    expect(wrapperDistribution(properties, "/home/runner/.gradle")).toEqual({
      markerPath:
        "/home/runner/.gradle/wrapper/dists/gradle-9.4.1-bin/arn2x92ynaizyzdaamcbpbhtj/gradle-9.4.1-bin.zip.ok",
      sha256: undefined,
      sources: {
        checksums: [
          { kind: "file", url: `${distributionUrl}.sha256` },
          { kind: "file", url: mirrorChecksumUrl },
          {
            asset: "gradle-9.4.1-bin.zip",
            kind: "github-asset",
            url: githubReleaseUrl,
          },
        ],
        zips: [distributionUrl, mirrorUrl],
      },
      url: distributionUrl,
      zipPath:
        "/home/runner/.gradle/wrapper/dists/gradle-9.4.1-bin/arn2x92ynaizyzdaamcbpbhtj/gradle-9.4.1-bin.zip",
    });
  });

  test("refuses a project-relative distribution base", () => {
    expect(() =>
      wrapperDistribution(
        properties.replace(
          "distributionBase=GRADLE_USER_HOME",
          "distributionBase=PROJECT"
        ),
        "/home/runner/.gradle"
      )
    ).toThrow("distributionBase");
  });
});

describe("distributionSources", () => {
  // The URLs services.gradle.org redirects these distributions to.
  test("names the GitHub release services.gradle.org redirects each distribution to", () => {
    expect(
      [
        "gradle-9.4.1-bin.zip",
        "gradle-8.10-all.zip",
        "gradle-9.9.0-rc-1-bin.zip",
        "gradle-9.9.0-milestone-1-bin.zip",
      ].map(
        (file) =>
          distributionSources(
            `https://services.gradle.org/distributions/${file}`
          ).zips[1]
      )
    ).toEqual([
      "https://github.com/gradle/gradle-distributions/releases/download/v9.4.1/gradle-9.4.1-bin.zip",
      "https://github.com/gradle/gradle-distributions/releases/download/v8.10.0/gradle-8.10-all.zip",
      "https://github.com/gradle/gradle-distributions/releases/download/v9.9.0-RC1/gradle-9.9.0-rc-1-bin.zip",
      "https://github.com/gradle/gradle-distributions/releases/download/v9.9.0-M1/gradle-9.9.0-milestone-1-bin.zip",
    ]);
  });

  test("has no fallback for a distribution served from elsewhere", () => {
    for (const url of [
      "https://gradle.example.com/distributions/gradle-9.4.1-bin.zip",
      "https://services.gradle.org/distributions-snapshots/gradle-9.5-20260101000000+0000-bin.zip",
    ]) {
      expect(distributionSources(url)).toEqual({
        checksums: [{ kind: "file", url: `${url}.sha256` }],
        zips: [url],
      });
    }
  });
});

describe("prepareGradle", () => {
  test("downloads a checked distribution into the wrapper's directory and raises Gradle's retries", async () => {
    const home = gradleHome();
    const { download, requests } = fakeDownload({
      [distributionUrl]: zip,
      [`${distributionUrl}.sha256`]: `${zipSha256}\n`,
    });
    const { distribution, prefetch } = await prepareGradle({
      download,
      gradleUserHome: home,
      wrapperProperties: properties,
    });
    expect(prefetch).toEqual({
      checksumUrl: `${distributionUrl}.sha256`,
      result: "downloaded",
      skipped: [],
      zipUrl: distributionUrl,
    });
    expect(requests).toEqual([`${distributionUrl}.sha256`, distributionUrl]);
    expect(readFileSync(distribution.zipPath)).toEqual(zip);
    expect(readdirSync(dirname(distribution.zipPath))).toEqual([
      "gradle-9.4.1-bin.zip",
    ]);
    expect(readFileSync(join(home, "gradle.properties"), "utf8")).toBe(
      withGradleProperties("", gradleNetworkProperties)
    );
  });

  test("leaves no zip behind when the checksum differs", async () => {
    const home = gradleHome();
    const { download, requests } = fakeDownload({
      [distributionUrl]: Buffer.from("truncated"),
      [`${distributionUrl}.sha256`]: zipSha256,
      [mirrorUrl]: zip,
    });
    const distribution = wrapperDistribution(properties, home);
    await expect(
      prepareGradle({
        download,
        gradleUserHome: home,
        wrapperProperties: properties,
      })
    ).rejects.toThrow("SHA-256");
    // A wrong file is no outage: the mirror isn't asked.
    expect(requests).toEqual([`${distributionUrl}.sha256`, distributionUrl]);
    expect(readdirSync(dirname(distribution.zipPath))).toEqual([]);
  });

  test("falls back to the GitHub mirror and Gradle's download host when services.gradle.org fails", async () => {
    const home = gradleHome();
    const { download, efforts, requests } = fakeDownload({
      [mirrorUrl]: zip,
      [mirrorChecksumUrl]: zipSha256,
    });
    const { distribution, prefetch } = await prepareGradle({
      download,
      gradleUserHome: home,
      wrapperProperties: properties,
    });
    expect(prefetch).toEqual({
      checksumUrl: mirrorChecksumUrl,
      result: "downloaded",
      skipped: [`${distributionUrl}.sha256: 404 ${distributionUrl}.sha256`],
      zipUrl: mirrorUrl,
    });
    // After its first failure services.gradle.org isn't asked again, and only
    // the last source of each file gets curl's full retries.
    expect(efforts).toEqual([
      `quick ${distributionUrl}.sha256`,
      `quick ${mirrorChecksumUrl}`,
      `patient ${mirrorUrl}`,
    ]);
    expect(requests).toEqual([
      `${distributionUrl}.sha256`,
      mirrorChecksumUrl,
      mirrorUrl,
    ]);
    expect(readFileSync(distribution.zipPath)).toEqual(zip);
  });

  test("checks against the digest GitHub lists when no .sha256 file answers", async () => {
    const home = gradleHome();
    const { download, requests } = fakeDownload({
      [`${distributionUrl}.sha256`]: "<html>Gateway Timeout</html>",
      [githubReleaseUrl]: githubRelease,
      [mirrorUrl]: zip,
    });
    const { distribution, prefetch } = await prepareGradle({
      download,
      gradleUserHome: home,
      wrapperProperties: properties,
    });
    expect(prefetch).toEqual({
      checksumUrl: githubReleaseUrl,
      result: "downloaded",
      skipped: [
        `${distributionUrl}.sha256: ${distributionUrl}.sha256 states no SHA-256 for the distribution.`,
        `${mirrorChecksumUrl}: 404 ${mirrorChecksumUrl}`,
      ],
      zipUrl: mirrorUrl,
    });
    expect(requests).toEqual([
      `${distributionUrl}.sha256`,
      mirrorChecksumUrl,
      githubReleaseUrl,
      mirrorUrl,
    ]);
    expect(readFileSync(distribution.zipPath)).toEqual(zip);
  });

  test("takes the zip from the mirror when only services.gradle.org's zip fails", async () => {
    const home = gradleHome();
    const { download, requests } = fakeDownload({
      [`${distributionUrl}.sha256`]: zipSha256,
      [mirrorUrl]: zip,
    });
    const { prefetch } = await prepareGradle({
      download,
      gradleUserHome: home,
      wrapperProperties: properties,
    });
    expect(prefetch).toEqual({
      checksumUrl: `${distributionUrl}.sha256`,
      result: "downloaded",
      skipped: [`${distributionUrl}: 404 ${distributionUrl}`],
      zipUrl: mirrorUrl,
    });
    expect(requests).toEqual([
      `${distributionUrl}.sha256`,
      distributionUrl,
      mirrorUrl,
    ]);
  });

  test("fails with every source's error when both sources fail", async () => {
    const home = gradleHome();
    const { download } = fakeDownload({
      [`${distributionUrl}.sha256`]: zipSha256,
    });
    const distribution = wrapperDistribution(properties, home);
    const failure = prepareGradle({
      download,
      gradleUserHome: home,
      wrapperProperties: properties,
    });
    await expect(failure).rejects.toThrow(`404 ${distributionUrl}`);
    await expect(failure).rejects.toThrow(`404 ${mirrorUrl}`);
    expect(readdirSync(dirname(distribution.zipPath))).toEqual([]);
  });

  test("gives a distribution without a fallback curl's full retries", async () => {
    const home = gradleHome();
    const url = "https://gradle.example.com/distributions/gradle-9.4.1-bin.zip";
    const { download, efforts } = fakeDownload({
      [url]: zip,
      [`${url}.sha256`]: zipSha256,
    });
    await prepareGradle({
      download,
      gradleUserHome: home,
      wrapperProperties: properties.replace(
        "https\\://services.gradle.org/distributions/gradle-9.4.1-bin.zip",
        url.replace(":", "\\:")
      ),
    });
    expect(efforts).toEqual([`patient ${url}.sha256`, `patient ${url}`]);
  });

  test("leaves no zip behind when the mirror's file fails the checksum", async () => {
    const home = gradleHome();
    const { download } = fakeDownload({
      [mirrorUrl]: Buffer.from("truncated"),
      [mirrorChecksumUrl]: zipSha256,
    });
    const distribution = wrapperDistribution(properties, home);
    await expect(
      prepareGradle({
        download,
        gradleUserHome: home,
        wrapperProperties: properties,
      })
    ).rejects.toThrow(`${mirrorUrl} has SHA-256`);
    expect(readdirSync(dirname(distribution.zipPath))).toEqual([]);
  });

  test("checks against distributionSha256Sum when the properties pin one", async () => {
    const home = gradleHome();
    const { download, requests } = fakeDownload({ [distributionUrl]: zip });
    const { prefetch } = await prepareGradle({
      download,
      gradleUserHome: home,
      wrapperProperties: `${properties}distributionSha256Sum=${zipSha256.toUpperCase()}\n`,
    });
    expect(prefetch).toEqual({
      checksumUrl: undefined,
      result: "downloaded",
      skipped: [],
      zipUrl: distributionUrl,
    });
    expect(requests).toEqual([distributionUrl]);
  });

  test("downloads nothing when a restored cache has the unpacked distribution", async () => {
    const home = gradleHome();
    const distribution = wrapperDistribution(properties, home);
    mkdirSync(dirname(distribution.markerPath), { recursive: true });
    writeFileSync(distribution.markerPath, "");
    const { download, requests } = fakeDownload({});
    const { prefetch } = await prepareGradle({
      download,
      gradleUserHome: home,
      wrapperProperties: properties,
    });
    expect(prefetch).toEqual({ result: "installed" });
    expect(requests).toEqual([]);
    expect(existsSync(distribution.zipPath)).toBe(false);
  });
});

describe("gradleNetworkProperties", () => {
  // The names Gradle 9.4.1 reads (ErrorHandlingModuleComponentRepository,
  // JavaSystemPropertiesHttpTimeoutSettings); Gradle ignores any other.
  test("sets the system properties Gradle reads for download retries and timeouts", () => {
    expect(Object.keys(gradleNetworkProperties).toSorted()).toEqual([
      "systemProp.org.gradle.internal.http.connectionTimeout",
      "systemProp.org.gradle.internal.http.socketTimeout",
      "systemProp.org.gradle.internal.repository.initial.backoff",
      "systemProp.org.gradle.internal.repository.max.tentatives",
    ]);
  });
});

describe("withGradleProperties", () => {
  test("appends only the keys the file doesn't set", () => {
    expect(
      withGradleProperties(
        "# settings\norg.gradle.jvmargs=-Xmx3g\nsystemProp.org.gradle.internal.repository.max.tentatives = 2",
        {
          "systemProp.org.gradle.internal.repository.max.tentatives": "6",
          "systemProp.org.gradle.internal.http.socketTimeout": "120000",
        }
      )
    ).toBe(
      "# settings\norg.gradle.jvmargs=-Xmx3g\nsystemProp.org.gradle.internal.repository.max.tentatives = 2\nsystemProp.org.gradle.internal.http.socketTimeout=120000\n"
    );
  });

  test("returns the text unchanged when every key is set", () => {
    const text = withGradleProperties("", gradleNetworkProperties);
    expect(withGradleProperties(text, gradleNetworkProperties)).toBe(text);
  });
});
