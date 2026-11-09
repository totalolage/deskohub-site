import "@/shared/testing/workspace-test-env";

import { afterEach, describe, expect, test } from "bun:test";
import { createVerify, randomUUID } from "node:crypto";
import { parseDictionary } from "structured-headers";
import type {
  MobileUpdatePlatform,
  MobileUpdatePublication,
} from "@/features/mobile-updates/mobile-update-publication";
import {
  publishRequest,
  resetMobileUpdatesSecrets,
  signingKeys,
  syntheticUpdate,
  uniqueRuntimeVersion,
  unsetMobileUpdatesSecret,
} from "@/features/mobile-updates/mobile-update-routes.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { parseMultipartMixed } from "@/shared/utils/multipart-mixed";

const testDatabase = await connectWorkspacePostgresTestDatabase();
const { POST } = await import("../route");
const { GET } = await import("./route");

const manifestRequest = (
  target: {
    readonly platform: string;
    readonly runtimeVersion: string;
  },
  headers: Record<string, string> = {}
) =>
  new Request("https://workspace.test/api/mobile/updates/manifest", {
    headers: {
      "expo-protocol-version": "1",
      "expo-platform": target.platform,
      "expo-runtime-version": target.runtimeVersion,
      accept: "multipart/mixed,application/expo+json,application/json",
      "expo-expect-signature": 'sig, keyid="main", alg="rsa-v1_5-sha256"',
      ...headers,
    },
  });

const partsOf = async (response: Response) => {
  const parts = parseMultipartMixed(
    response.headers.get("content-type") ?? "",
    await response.text()
  );
  if (!parts) throw new Error("The response is not multipart/mixed");

  return Object.fromEntries(
    parts.map((part) => [
      /name="([^"]+)"/.exec(part.headers.get("content-disposition") ?? "")?.[1],
      part,
    ])
  );
};

const verifiesSignature = (part: { headers: Headers; body: string }) => {
  const signature = parseDictionary(part.headers.get("expo-signature") ?? "");
  const [sig] = signature.get("sig") ?? [];
  const [keyid] = signature.get("keyid") ?? [];
  expect(keyid).toBe("main");

  return createVerify("RSA-SHA256")
    .update(part.body, "utf8")
    .verify(signingKeys.publicKey, String(sig), "base64");
};

const publish = async (publication: MobileUpdatePublication) => {
  const response = await POST(publishRequest(publication));
  expect(response.status).toBe(201);
};

const target = (platform: MobileUpdatePlatform = "android") => ({
  platform,
  runtimeVersion: uniqueRuntimeVersion(),
});

describe.skipIf(!testDatabase)("mobile update manifest route", () => {
  afterEach(resetMobileUpdatesSecrets);

  test("serves the newest update for the platform and runtime version as a signed manifest", async () => {
    const android = target();
    const older = syntheticUpdate(android);
    const newer = syntheticUpdate(android);
    await publish(older);
    await publish(newer);
    await publish(syntheticUpdate({ ...android, platform: "ios" }));

    const response = await GET(manifestRequest(android));

    expect(response.status).toBe(200);
    expect(response.headers.get("expo-protocol-version")).toBe("1");
    expect(response.headers.get("expo-sfv-version")).toBe("0");
    expect(response.headers.get("expo-manifest-filters")).toBe("");
    expect(response.headers.get("expo-server-defined-headers")).toBe("");
    expect(response.headers.get("cache-control")).toBe("private, max-age=0");
    expect(response.headers.get("content-type")).toStartWith(
      "multipart/mixed; boundary="
    );

    const { manifest, extensions, directive } = await partsOf(response);
    expect(directive).toBeUndefined();
    expect(manifest?.headers.get("content-type")).toBe(
      "application/json; charset=utf-8"
    );
    expect(manifest && verifiesSignature(manifest)).toBe(true);

    const body = JSON.parse(manifest?.body ?? "");
    expect(body).toEqual({
      id: newer.id,
      createdAt: expect.stringMatching(
        /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/
      ),
      runtimeVersion: android.runtimeVersion,
      launchAsset: newer.type === "update" ? newer.launchAsset : undefined,
      assets: newer.type === "update" ? newer.assets : undefined,
      metadata: { branch: "synthetic" },
      extra: { expoClient: { name: "Synthetic", slug: "synthetic" } },
    });
    expect(JSON.parse(extensions?.body ?? "")).toEqual({
      assetRequestHeaders: {},
    });
  });

  test("answers noUpdateAvailable to a runtime version without publications", async () => {
    const android = target();
    await publish(syntheticUpdate(android));

    const response = await GET(
      manifestRequest({ ...android, runtimeVersion: uniqueRuntimeVersion() })
    );

    expect(response.status).toBe(200);
    const { manifest, directive } = await partsOf(response);
    expect(manifest).toBeUndefined();
    expect(JSON.parse(directive?.body ?? "")).toEqual({
      type: "noUpdateAvailable",
    });
    expect(directive && verifiesSignature(directive)).toBe(true);
  });

  test("answers noUpdateAvailable to an app already running the newest update", async () => {
    const android = target();
    const update = syntheticUpdate(android);
    await publish(update);

    const response = await GET(
      manifestRequest(android, { "expo-current-update-id": update.id })
    );

    const { directive } = await partsOf(response);
    expect(JSON.parse(directive?.body ?? "")).toEqual({
      type: "noUpdateAvailable",
    });
  });

  test("sends the app back to its embedded update after a rollback", async () => {
    const android = target();
    const update = syntheticUpdate(android);
    await publish(update);
    await publish({ type: "rollBackToEmbedded", id: randomUUID(), ...android });

    const response = await GET(
      manifestRequest(android, {
        "expo-current-update-id": update.id,
        "expo-embedded-update-id": randomUUID(),
      })
    );

    const { directive } = await partsOf(response);
    expect(directive && verifiesSignature(directive)).toBe(true);
    const body = JSON.parse(directive?.body ?? "");
    expect(body).toEqual({
      type: "rollBackToEmbedded",
      parameters: { commitTime: expect.any(String) },
    });
  });

  // An app on its embedded update may hold the rolled-back update, downloaded
  // but not launched yet; only the directive stops its next start from
  // launching it. expo-updates ignores the directive once the app has
  // restarted into its embedded update.
  test("sends the rollback to an app that runs its embedded update too", async () => {
    const android = target();
    await publish({ type: "rollBackToEmbedded", id: randomUUID(), ...android });
    const embeddedUpdateId = randomUUID();

    const response = await GET(
      manifestRequest(android, {
        "expo-current-update-id": embeddedUpdateId,
        "expo-embedded-update-id": embeddedUpdateId,
      })
    );

    const { directive } = await partsOf(response);
    expect(directive && verifiesSignature(directive)).toBe(true);
    expect(JSON.parse(directive?.body ?? "")).toEqual({
      type: "rollBackToEmbedded",
      parameters: { commitTime: expect.any(String) },
    });
  });

  test("leaves parts unsigned when the app expects no signature", async () => {
    const android = target();
    await publish(syntheticUpdate(android));
    const request = manifestRequest(android);
    request.headers.delete("expo-expect-signature");

    const { manifest } = await partsOf(await GET(request));

    expect(manifest?.headers.has("expo-signature")).toBe(false);
  });

  test("answers 503 to an app expecting a signature while no signing key is configured", async () => {
    unsetMobileUpdatesSecret("MOBILE_UPDATES_SIGNING_PRIVATE_KEY");

    const response = await GET(manifestRequest(target()));

    expect(response.status).toBe(503);
  });

  test.each([
    ["an unknown platform", { "expo-platform": "web" }, 400],
    ["no runtime version", { "expo-runtime-version": "" }, 400],
    ["another protocol version", { "expo-protocol-version": "0" }, 406],
    ["no multipart in Accept", { accept: "application/json" }, 406],
  ])("rejects a request with %s", async (_, headers, status) => {
    const response = await GET(manifestRequest(target(), headers));

    expect(response.status).toBe(status);
  });
});
