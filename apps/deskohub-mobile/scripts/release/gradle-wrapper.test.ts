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
  const download: Download = async (url, path) => {
    requests.push(url);
    const body = files[url];
    if (body === undefined) {
      throw new Error(`404 ${url}`);
    }
    writeFileSync(path, body);
  };
  return { download, requests };
};

const distributionUrl =
  "https://services.gradle.org/distributions/gradle-9.4.1-bin.zip";

describe("wrapperDistribution", () => {
  test("names the zip where Gradle's wrapper looks for it", () => {
    // The directory a real wrapper created for this URL.
    expect(wrapperDistribution(properties, "/home/runner/.gradle")).toEqual({
      markerPath:
        "/home/runner/.gradle/wrapper/dists/gradle-9.4.1-bin/arn2x92ynaizyzdaamcbpbhtj/gradle-9.4.1-bin.zip.ok",
      sha256: undefined,
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

describe("prepareGradle", () => {
  test("downloads a checked distribution into the wrapper's directory and raises Gradle's retries", async () => {
    const home = gradleHome();
    const { download, requests } = fakeDownload({
      [distributionUrl]: zip,
      [`${distributionUrl}.sha256`]: `${zipSha256}\n`,
    });
    const { distribution, result } = await prepareGradle({
      download,
      gradleUserHome: home,
      wrapperProperties: properties,
    });
    expect(result).toBe("downloaded");
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
    const { download } = fakeDownload({
      [distributionUrl]: Buffer.from("truncated"),
      [`${distributionUrl}.sha256`]: zipSha256,
    });
    const distribution = wrapperDistribution(properties, home);
    await expect(
      prepareGradle({
        download,
        gradleUserHome: home,
        wrapperProperties: properties,
      })
    ).rejects.toThrow("SHA-256");
    expect(readdirSync(dirname(distribution.zipPath))).toEqual([]);
  });

  test("checks against distributionSha256Sum when the properties pin one", async () => {
    const home = gradleHome();
    const { download, requests } = fakeDownload({ [distributionUrl]: zip });
    const { result } = await prepareGradle({
      download,
      gradleUserHome: home,
      wrapperProperties: `${properties}distributionSha256Sum=${zipSha256.toUpperCase()}\n`,
    });
    expect(result).toBe("downloaded");
    expect(requests).toEqual([distributionUrl]);
  });

  test("downloads nothing when a restored cache has the unpacked distribution", async () => {
    const home = gradleHome();
    const distribution = wrapperDistribution(properties, home);
    mkdirSync(dirname(distribution.markerPath), { recursive: true });
    writeFileSync(distribution.markerPath, "");
    const { download, requests } = fakeDownload({});
    const { result } = await prepareGradle({
      download,
      gradleUserHome: home,
      wrapperProperties: properties,
    });
    expect(result).toBe("installed");
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
