import "server-only";

import { createSign } from "node:crypto";
import { Data, Effect } from "effect";
import { serializeDictionary } from "structured-headers";
import { env } from "@/env";

/** The key id and algorithm the app's `updates.codeSigningMetadata` names. */
const manifestSigningKeyId = "main";
const manifestSigningAlgorithm = "rsa-v1_5-sha256";

class ManifestSigningUnavailable extends Data.TaggedError(
  "ManifestSigningUnavailable"
)<{ readonly cause?: unknown }> {}

/**
 * The `expo-signature` value for a manifest or directive body: an RSA
 * PKCS #1 v1.5 SHA-256 signature over the body's exact UTF-8 bytes, which the
 * app verifies with its embedded certificate before it uses the body.
 */
export const signManifestBody = Effect.fn("signManifestBody")(function* (
  body: string
) {
  const privateKey = env.MOBILE_UPDATES_SIGNING_PRIVATE_KEY;
  if (privateKey === undefined)
    return yield* new ManifestSigningUnavailable({});

  const signature = yield* Effect.try({
    try: () =>
      createSign("RSA-SHA256").update(body, "utf8").sign(privateKey, "base64"),
    catch: (cause) => new ManifestSigningUnavailable({ cause }),
  });

  return serializeDictionary({
    sig: signature,
    keyid: manifestSigningKeyId,
    alg: manifestSigningAlgorithm,
  });
});
