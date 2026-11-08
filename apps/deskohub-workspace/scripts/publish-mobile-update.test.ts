import { afterEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Schema } from "effect";
import { runCommand } from "./shared/command";

const scriptPath = fileURLToPath(
  new URL("./publish-mobile-update.ts", import.meta.url)
);
const httpFixturePath = fileURLToPath(
  new URL("./publish-mobile-update.http-fixture.ts", import.meta.url)
);
const expoFixturePath = fileURLToPath(
  new URL("./publish-mobile-update.expo-fixture.ts", import.meta.url)
);
const workspaceRoot = resolve(import.meta.dir, "..");

const blobToken = "vercel_blob_rw_fixturestore_syntheticblobtoken";
const publishToken = "synthetic-mobile-updates-publish-token";
const bypassSecret = "synthetic-protection-bypass-secret";

const appKeys = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const deployedKeys = {
  matching: appKeys.privateKey,
  other: generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  }).privateKey,
};

// SHA-256 digests of the fixture export's files (see exported-update.test.ts).
const stored = {
  androidBundle:
    "mobile-updates/assets/9295f55b921438c98c566a78ab327261ff5e17328b855d8e8b8e13ce1027429f.hbc",
  iosBundle:
    "mobile-updates/assets/4656317d10d1666af4992666d3b0fd03b4c24bb71eba8ef09510bd225f01a05e.hbc",
  image:
    "mobile-updates/assets/c06303dd848a80e9e774747ca5f185ba68129bb55e4842c72ed477340fc8100c.png",
};
const blobUrl = (pathname: string) =>
  `https://fixture-store.public.blob.vercel-storage.com/${pathname}`;

/** A request or Expo CLI call the fixtures recorded, as JSON. */
interface Recorded {
  readonly kind: string;
  readonly [field: string]: Schema.Json;
}

let workDirectory: string | undefined;
afterEach(() => {
  if (workDirectory) rmSync(workDirectory, { recursive: true, force: true });
  workDirectory = undefined;
});

/** A project directory whose `expo` and `expo-updates` are the fixture CLI. */
const fixtureProject = (directory: string) => {
  const project = join(directory, "app");
  const bin = join(project, "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(project, "package.json"), '{"name":"fixture-app"}');
  for (const cli of ["expo", "expo-updates"]) {
    writeFileSync(
      join(bin, cli),
      `#!/bin/sh\nexec "${process.execPath}" "${expoFixturePath}" ${cli} "$@"\n`
    );
    chmodSync(join(bin, cli), 0o755);
  }
  return project;
};

const publish = async ({
  args = [],
  deployedKey = deployedKeys.matching,
  env = {},
}: {
  readonly args?: readonly string[];
  readonly deployedKey?: string;
  readonly env?: Readonly<Record<string, string>>;
} = {}) => {
  workDirectory = mkdtempSync(join(tmpdir(), "publish-mobile-update-"));
  const recordFile = join(workDirectory, "requests.jsonl");
  const certificate = join(workDirectory, "app-public-key.pem");
  writeFileSync(certificate, appKeys.publicKey);

  const result = await runCommand(
    [
      process.execPath,
      "--preload",
      httpFixturePath,
      scriptPath,
      "--project",
      fixtureProject(workDirectory),
      "--target",
      "https://workspace.test",
      "--certificate",
      certificate,
      ...args,
    ],
    {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        TMPDIR: workDirectory,
        BLOB_READ_WRITE_TOKEN: blobToken,
        MOBILE_UPDATES_PUBLISH_TOKEN: publishToken,
        VERCEL_AUTOMATION_BYPASS_SECRET: "",
        VERCEL_BLOB_RETRIES: "0",
        PUBLISH_FIXTURE_RECORD: recordFile,
        PUBLISH_FIXTURE_SIGNING_KEY: deployedKey,
        ...env,
      },
      timeoutMs: 30_000,
    }
  );
  const recorded: readonly Recorded[] = existsSync(recordFile)
    ? readFileSync(recordFile, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
    : [];
  const output = `${result.stdout}${result.stderr}`;
  return {
    ...result,
    output,
    recorded,
    of: (kind: string) => recorded.filter((entry) => entry.kind === kind),
  };
};

const expectNoSecrets = (output: string) => {
  for (const secret of [blobToken, publishToken, bypassSecret]) {
    expect(output).not.toContain(secret);
  }
};

describe("publish-mobile-update", () => {
  test("stores each file once and publishes a verified update per platform", async () => {
    const result = await publish();

    expect(result.exitCode).toBe(0);
    expect(result.of("blob-put")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pathname: stored.image,
          contentType: "image/png",
          addRandomSuffix: "0",
          allowOverwrite: "0",
          cacheControlMaxAge: "31536000",
          sha256:
            "c06303dd848a80e9e774747ca5f185ba68129bb55e4842c72ed477340fc8100c",
        }),
        expect.objectContaining({
          pathname: stored.androidBundle,
          contentType: "application/javascript",
        }),
        expect.objectContaining({ pathname: stored.iosBundle }),
      ])
    );
    expect(result.of("blob-put")).toHaveLength(3);
    // Nothing is published until every file is stored.
    const kinds = result.recorded.map(({ kind }) => kind);
    expect(kinds.lastIndexOf("blob-put")).toBeLessThan(
      kinds.indexOf("publish")
    );

    const publications = result.of("publish");
    expect(publications.map(({ authorization }) => authorization)).toEqual([
      `Bearer ${publishToken}`,
      `Bearer ${publishToken}`,
    ]);
    expect(publications.map(({ publication }) => publication)).toEqual([
      expect.objectContaining({
        type: "update",
        platform: "android",
        runtimeVersion: "fixture-runtime-android",
        launchAsset: expect.objectContaining({
          url: blobUrl(stored.androidBundle),
        }),
        assets: [expect.objectContaining({ url: blobUrl(stored.image) })],
        extra: {
          expoClient: {
            name: "Synthetic",
            slug: "synthetic",
            version: "1.0.0",
          },
        },
      }),
      expect.objectContaining({
        type: "update",
        platform: "ios",
        runtimeVersion: "fixture-runtime-ios",
        launchAsset: expect.objectContaining({
          url: blobUrl(stored.iosBundle),
        }),
      }),
    ]);
    const [androidId, iosId] = publications.map(
      ({ publication }) => (publication as { readonly id: string }).id
    );
    expect(androidId).not.toBe(iosId);

    // Each platform is checked once before anything changes, then once
    // after its publication.
    const platformChecks = [
      expect.objectContaining({
        platform: "android",
        runtimeVersion: "fixture-runtime-android",
        protocolVersion: "1",
        expectsSignature: true,
      }),
      expect.objectContaining({
        platform: "ios",
        runtimeVersion: "fixture-runtime-ios",
        expectsSignature: true,
      }),
    ];
    expect(result.of("update-check")).toEqual([
      ...platformChecks,
      ...platformChecks,
    ]);
    expect(result.output).toContain(`id=${androidId}`);
    expect(result.output).toContain(`id=${iosId}`);
    expectNoSecrets(result.output);
  });

  test("exports only the requested platforms and leaves the export behind", async () => {
    const result = await publish({ args: ["--platform", "ios"] });

    expect(result.exitCode).toBe(0);
    const [exportCall] = result
      .of("expo")
      .filter(({ args }) => (args as string[])[0] === "export");
    const exportArgs = exportCall?.args as string[];
    expect(exportArgs).toEqual(
      expect.arrayContaining(["--platform", "ios", "--dump-assetmap"])
    );
    expect(exportArgs).not.toContain("android");
    expect(exportArgs).not.toContain("all");
    expect(result.of("publish").map(({ publication }) => publication)).toEqual([
      expect.objectContaining({ platform: "ios" }),
    ]);

    const outputDirectory = exportArgs[exportArgs.indexOf("--output-dir") + 1];
    expect(outputDirectory && existsSync(outputDirectory)).toBe(false);
  });

  test("reuses files the store already holds", async () => {
    const result = await publish({
      env: { PUBLISH_FIXTURE_STORED: `${stored.image},${stored.iosBundle}` },
    });

    expect(result.exitCode).toBe(0);
    expect(result.of("blob-put").map(({ pathname }) => pathname)).toEqual([
      stored.androidBundle,
    ]);
    expect(result.of("publish")).toHaveLength(2);
  });

  test("sends the protection bypass to a protected preview deployment", async () => {
    const result = await publish({
      env: { VERCEL_AUTOMATION_BYPASS_SECRET: bypassSecret },
    });

    expect(result.exitCode).toBe(0);
    for (const request of [
      ...result.of("publish"),
      ...result.of("update-check"),
    ]) {
      expect(request.bypass).toBe(bypassSecret);
    }
    expectNoSecrets(result.output);
  });

  test.each([
    { mode: "publish", args: [] },
    { mode: "rollback", args: ["--rollback"] },
  ])(
    "changes nothing when the deployment signs with another key ($mode)",
    async ({ args }) => {
      const result = await publish({
        args,
        deployedKey: deployedKeys.other,
      });

      expect(result.exitCode).toBe(1);
      expect(result.of("update-check").length).toBeGreaterThan(0);
      expect(result.of("blob-put")).toHaveLength(0);
      expect(result.of("publish")).toHaveLength(0);
      expectNoSecrets(result.output);
    }
  );

  test("stops after the first platform when the deployment serves another update", async () => {
    const result = await publish({
      env: { PUBLISH_FIXTURE_MANIFEST: "another-update" },
    });

    expect(result.exitCode).toBe(1);
    expect(result.of("publish")).toHaveLength(1);
  });

  test("fails when the deployment refuses the publication", async () => {
    const result = await publish({
      env: { PUBLISH_FIXTURE_PUBLISH_STATUS: "409" },
    });

    expect(result.exitCode).toBe(1);
    expect(result.of("publish")).toHaveLength(1);
    // Only the checks before publishing ran.
    expect(result.of("update-check")).toHaveLength(2);
    expectNoSecrets(result.output);
  });

  test("rolls each platform back to its embedded update without exporting", async () => {
    const result = await publish({ args: ["--rollback"] });

    expect(result.exitCode).toBe(0);
    expect(result.of("blob-put")).toHaveLength(0);
    expect(
      result.of("expo").filter(({ args }) => (args as string[])[0] === "export")
    ).toHaveLength(0);
    expect(result.of("publish").map(({ publication }) => publication)).toEqual([
      {
        type: "rollBackToEmbedded",
        id: expect.any(String),
        platform: "android",
        runtimeVersion: "fixture-runtime-android",
      },
      {
        type: "rollBackToEmbedded",
        id: expect.any(String),
        platform: "ios",
        runtimeVersion: "fixture-runtime-ios",
      },
    ]);
    expect(result.of("update-check")).toHaveLength(4);
  });

  test("rolls back without a Blob token", async () => {
    const result = await publish({
      args: ["--rollback"],
      env: { BLOB_READ_WRITE_TOKEN: "" },
    });

    expect(result.exitCode).toBe(0);
    expect(result.of("publish")).toHaveLength(2);
  });

  test("publishes nothing without a Blob token", async () => {
    const result = await publish({ env: { BLOB_READ_WRITE_TOKEN: "" } });

    expect(result.exitCode).toBe(1);
    expect(result.of("publish")).toHaveLength(0);
  });

  test("publishes once when the deployment recorded a publish whose response was lost", async () => {
    const result = await publish({
      env: { PUBLISH_FIXTURE_LOSE_FIRST_RESPONSE: "1" },
    });

    expect(result.exitCode).toBe(0);
    const ids = result
      .of("publish")
      .map(({ publication }) => (publication as { readonly id: string }).id);
    expect(ids).toHaveLength(3);
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).not.toBe(ids[0]);
    expect(result.output).toContain("outcome=already-published");
  });

  test("publishes nothing when a file can't be stored", async () => {
    const result = await publish({
      env: { PUBLISH_FIXTURE_BLOB_UPLOADS: "unavailable" },
    });

    expect(result.exitCode).toBe(1);
    expect(result.of("blob-put").length).toBeGreaterThan(0);
    expect(result.of("publish")).toHaveLength(0);
    expectNoSecrets(result.output);
  });

  test("changes nothing when the deployment is unreachable", async () => {
    const result = await publish({
      env: { PUBLISH_FIXTURE_TARGET: "unreachable" },
    });

    expect(result.exitCode).toBe(1);
    expect(result.of("unreachable").length).toBeGreaterThan(1);
    expect(result.of("blob-put")).toHaveLength(0);
    expectNoSecrets(result.output);
    // The retries back off for about seven seconds before the run gives up.
  }, 30_000);

  test("refuses a target reached without TLS", async () => {
    const result = await publish({
      args: ["--target", "http://workspace.test"],
    });

    expect(result.exitCode).toBe(1);
    expect(result.recorded).toHaveLength(0);
  });

  test("publishes nothing without the publish token", async () => {
    const result = await publish({ env: { MOBILE_UPDATES_PUBLISH_TOKEN: "" } });

    expect(result.exitCode).toBe(1);
    expect(result.of("publish")).toHaveLength(0);
    expect(result.of("blob-put")).toHaveLength(0);
    expectNoSecrets(result.output);
  });
});
