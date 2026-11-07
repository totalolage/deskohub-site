import { mock } from "bun:test";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import * as workspaceEnv from "@/env";
import type {
  MobileUpdatePlatform,
  MobileUpdatePublication,
} from "./mobile-update-publication";

const publishToken = "synthetic-mobile-updates-publish-token";

export const signingKeys = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

type MobileUpdatesSecret =
  | "MOBILE_UPDATES_PUBLISH_TOKEN"
  | "MOBILE_UPDATES_SIGNING_PRIVATE_KEY";

const syntheticSecrets = {
  MOBILE_UPDATES_PUBLISH_TOKEN: publishToken,
  MOBILE_UPDATES_SIGNING_PRIVATE_KEY: signingKeys.privateKey,
} satisfies Record<MobileUpdatesSecret, string>;

const unsetSecrets = new Set<string | symbol>();

/** Makes the routes see a deployment without the variable. */
export const unsetMobileUpdatesSecret = (name: MobileUpdatesSecret) => {
  unsetSecrets.add(name);
};

export const resetMobileUpdatesSecrets = () => {
  unsetSecrets.clear();
};

mock.module("@/env", () => ({
  ...workspaceEnv,
  env: new Proxy(workspaceEnv.env, {
    get: (target, key) => {
      if (unsetSecrets.has(key)) return undefined;
      if (key === "MOBILE_UPDATES_PUBLISH_TOKEN") {
        return syntheticSecrets.MOBILE_UPDATES_PUBLISH_TOKEN;
      }
      if (key === "MOBILE_UPDATES_SIGNING_PRIVATE_KEY") {
        return syntheticSecrets.MOBILE_UPDATES_SIGNING_PRIVATE_KEY;
      }
      return Reflect.get(target, key);
    },
  }),
}));

/** A runtime version no other test publishes to. */
export const uniqueRuntimeVersion = () => `test-runtime-${randomUUID()}`;

/** The protocol's asset hash: base64url SHA-256 of the file's bytes. */
const assetHash = (bytes: string) =>
  createHash("sha256").update(bytes).digest("base64url");

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
    hash: assetHash("synthetic bundle"),
    key: "bundle-key",
    contentType: "application/javascript",
    url: assetUrl("bundle.hbc"),
  },
  assets: [
    {
      hash: assetHash("synthetic image"),
      key: "image-key",
      contentType: "image/png",
      fileExtension: ".png",
      url: assetUrl("image.png"),
    },
  ],
  metadata: { branch: "synthetic" },
  extra: { expoClient: { name: "Synthetic", slug: "synthetic" } },
});

/** A publication, or one whose platform the server must reject. */
type PublicationBody =
  | MobileUpdatePublication
  | (Omit<MobileUpdatePublication, "platform"> & { readonly platform: string });

export const publishRequest = (
  publication: PublicationBody,
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
