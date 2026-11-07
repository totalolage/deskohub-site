import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mock } from "bun:test";
import * as workspaceEnv from "@/env";
import type {
  MobileUpdatePlatform,
  MobileUpdatePublication,
} from "./mobile-update-publication";

export const publishToken = "synthetic-mobile-updates-publish-token";

export const signingKeys = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

/** The mobile-updates variables the routes read, which tests may change. */
export const mobileUpdatesEnv: {
  MOBILE_UPDATES_PUBLISH_TOKEN: string | undefined;
  MOBILE_UPDATES_SIGNING_PRIVATE_KEY: string | undefined;
} = {
  MOBILE_UPDATES_PUBLISH_TOKEN: publishToken,
  MOBILE_UPDATES_SIGNING_PRIVATE_KEY: signingKeys.privateKey,
};

export const resetMobileUpdatesEnv = () => {
  mobileUpdatesEnv.MOBILE_UPDATES_PUBLISH_TOKEN = publishToken;
  mobileUpdatesEnv.MOBILE_UPDATES_SIGNING_PRIVATE_KEY = signingKeys.privateKey;
};

mock.module("@/env", () => ({
  ...workspaceEnv,
  env: new Proxy(workspaceEnv.env, {
    get: (target, key) =>
      typeof key === "string" && key in mobileUpdatesEnv
        ? mobileUpdatesEnv[key as keyof typeof mobileUpdatesEnv]
        : Reflect.get(target, key),
  }),
}));

/** A runtime version no other test publishes to. */
export const uniqueRuntimeVersion = () => `test-runtime-${randomUUID()}`;

const assetUrl = (name: string) =>
  `https://blob.example/mobile-updates/assets/${name}`;

export const syntheticUpdate = (
  target: {
    readonly platform: MobileUpdatePlatform;
    readonly runtimeVersion: string;
  },
  id: string = randomUUID()
): MobileUpdatePublication => ({
  type: "update",
  id,
  ...target,
  launchAsset: {
    hash: "bundle-hash",
    key: "bundle-key",
    contentType: "application/javascript",
    url: assetUrl("bundle.hbc"),
  },
  assets: [
    {
      hash: "image-hash",
      key: "image-key",
      contentType: "image/png",
      fileExtension: ".png",
      url: assetUrl("image.png"),
    },
  ],
  metadata: { branch: "synthetic" },
  extra: { expoClient: { name: "Synthetic", slug: "synthetic" } },
});

export const publishRequest = (
  publication: unknown,
  authorization: string | null = `Bearer ${publishToken}`
) =>
  new Request("https://workspace.test/api/mobile/updates", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorization !== null && { authorization }),
    },
    body: JSON.stringify(publication),
  });
