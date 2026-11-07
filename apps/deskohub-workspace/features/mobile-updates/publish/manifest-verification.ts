import { type KeyObject, verify } from "node:crypto";
import { Data, Effect, Schema } from "effect";
import { parseDictionary } from "structured-headers";
import { parseMultipartMixed } from "@/shared/utils/multipart-mixed";

/** The key id and algorithm the app's `updates.codeSigningMetadata` names. */
const appSigningKeyId = "main";
const appSigningAlgorithm = "rsa-v1_5-sha256";

/**
 * What an update check should answer: the manifest of a live update, the
 * rollback directive of a live rollback, or, before anything is published,
 * any manifest or directive the app accepts the signature of.
 */
export type ExpectedManifestReply =
  | { readonly type: "update"; readonly id: string }
  | { readonly type: "rollBackToEmbedded" }
  | { readonly type: "any" };

const expectedParts = {
  update: ["manifest"],
  rollBackToEmbedded: ["directive"],
  any: ["manifest", "directive"],
} as const satisfies Record<ExpectedManifestReply["type"], readonly string[]>;

/** An update check's response as it arrived. */
export interface ManifestReply {
  readonly contentType: string;
  readonly body: string;
}

class ManifestReplyUnverified extends Data.TaggedError(
  "ManifestReplyUnverified"
)<{ readonly message: string }> {}

/** The members of an `expo-signature` dictionary the app reads. */
const SignatureDictionary = Schema.Struct({
  sig: Schema.String,
  keyid: Schema.String,
  alg: Schema.optionalKey(Schema.String),
});

const SignedPart = Schema.fromJsonString(
  Schema.Union([
    Schema.Struct({ id: Schema.String }),
    Schema.Struct({ type: Schema.String }),
  ])
);

/**
 * Checks that an update check answers with the expected publication, signed
 * so the app accepts it: an RSA SHA-256 signature over the part's exact body
 * that verifies with the app's public key, under the key id the app trusts.
 */
export const verifyManifestReply = Effect.fn("verifyManifestReply")(function* (
  reply: ManifestReply,
  expected: ExpectedManifestReply,
  appPublicKey: KeyObject
) {
  const partNames: readonly string[] = expectedParts[expected.type];
  const parts = parseMultipartMixed(reply.contentType, reply.body) ?? [];
  const part = parts.find(({ headers }) =>
    partNames.some(
      (name) =>
        headers.get("content-disposition") === `form-data; name="${name}"`
    )
  );
  if (part === undefined) {
    return yield* unverified(
      `The update check answered without a ${partNames.join(" or ")}`
    );
  }
  const partName = partNames.length === 1 ? partNames[0] : "reply";

  const signature = yield* readAppSignature(part.headers.get("expo-signature"));
  const signedByApp =
    signature !== undefined &&
    verify(
      "RSA-SHA256",
      Buffer.from(part.body, "utf8"),
      appPublicKey,
      Buffer.from(signature, "base64")
    );
  if (!signedByApp) {
    return yield* unverified(
      `The ${partName} signature doesn't verify with the app's certificate`
    );
  }

  if (expected.type === "any") return;

  const served = yield* Schema.decodeEffect(SignedPart)(part.body).pipe(
    Effect.mapError(
      () =>
        new ManifestReplyUnverified({
          message: `The ${partName} is not JSON the app understands`,
        })
    )
  );
  const matches =
    expected.type === "update"
      ? "id" in served && served.id === expected.id
      : "type" in served && served.type === expected.type;
  if (!matches) {
    return yield* unverified(
      expected.type === "update"
        ? `The manifest serves another update than ${expected.id}`
        : `The directive is not ${expected.type}`
    );
  }
});

const unverified = (message: string) =>
  Effect.fail(new ManifestReplyUnverified({ message }));

/**
 * The signature in an `expo-signature` header when it is made for the app's
 * key id and algorithm; a missing `alg` means the key's own algorithm.
 */
const readAppSignature = (header: string | null) =>
  Effect.try(() => parseDictionary(header ?? "")).pipe(
    Effect.map((dictionary) =>
      Object.fromEntries([...dictionary].map(([name, [item]]) => [name, item]))
    ),
    Effect.flatMap(Schema.decodeUnknownEffect(SignatureDictionary)),
    Effect.map(({ sig, keyid, alg = appSigningAlgorithm }) =>
      keyid === appSigningKeyId && alg === appSigningAlgorithm ? sig : undefined
    ),
    Effect.orElseSucceed(() => undefined)
  );
