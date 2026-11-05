import { Context, Effect, Layer, Redacted, Schema } from "effect";
import { SealedStateTokenError } from "./sealed-state-error";

const keyByteLength = 32;

export const sealedStateKeyIdSchema = Schema.Trim.check(Schema.isNonEmpty())
  .pipe(Schema.brand("SealedStateKeyId"))
  .annotate({
    identifier: "SealedStateKeyId",
    description: "Identifier selecting a sealed state encryption key.",
  });
export type SealedStateKeyId = typeof sealedStateKeyIdSchema.Type;

export type SealedStateKey = {
  readonly kid: SealedStateKeyId;
  readonly key: Buffer;
};

/** Ordered keys: the first seals new state, and every key opens its own. */
type SealedStateKeyRing = readonly [SealedStateKey, ...SealedStateKey[]];

export interface ISealedStateKeys {
  readonly ring: SealedStateKeyRing;
  /**
   * The configured `kid:base64url-key` list exactly as written. Only the
   * legacy ring-keyed checkout lookup key reads it: its HMAC is keyed by the
   * whole string, so even a reformatted equivalent ring stops matching.
   */
  readonly configured: Redacted.Redacted<string>;
}

/**
 * The key ring of every sealed state, configured as
 * `CHECKOUT_PAY_STATE_KEYS`. Rotation follows the checkout key ring.
 */
export class SealedStateKeys extends Context.Service<
  SealedStateKeys,
  ISealedStateKeys
>()("@deskohub-workspace/SealedStateKeys") {
  // Loaded lazily, so importing the capability never validates the
  // environment. An environment that fails validation is an invalid secret,
  // as a ring that fails to parse is.
  static Default = Layer.unwrap(
    Effect.tryPromise({
      try: async () => {
        const { makeSealedStateKeysLayer } = await import(
          "./sealed-state-keys-provider.server"
        );
        return makeSealedStateKeysLayer();
      },
      catch: (cause) =>
        invalidSecret(
          "Workspace sealed state configuration is invalid.",
          cause
        ),
    })
  );

  /** The ring a `kid:base64url-key,…` list configures. */
  static fromConfiguration = (configured: string) =>
    Layer.effect(
      SealedStateKeys,
      parseSealedStateKeyRing(configured).pipe(
        Effect.map(
          (ring): ISealedStateKeys => ({
            ring,
            configured: Redacted.make(configured),
          })
        )
      )
    );
}

const invalidSecret = (message: string, cause?: unknown) =>
  new SealedStateTokenError({ code: "invalid-secret", message, cause });

const parseSealedStateKeyRing = Effect.fn("SealedStateKeys.parseRing")(
  function* (configured: string) {
    const keys = yield* Effect.forEach(configured.split(","), (entry) => {
      const [kid, key, ...extra] = entry.split(":");
      if (!kid || !key || extra.length > 0) {
        return Effect.fail(
          invalidSecret(
            "CHECKOUT_PAY_STATE_KEYS entries must be formatted as kid:base64url-32-byte-key."
          )
        );
      }

      return parseSealedStateKey(kid, key);
    });

    const [first, ...rest] = keys;
    if (!first) {
      return yield* new SealedStateTokenError({
        code: "missing-secret",
        message: "At least one sealed state encryption key is required.",
      });
    }

    return [first, ...rest] satisfies SealedStateKeyRing;
  }
);

const parseSealedStateKey = Effect.fn("SealedStateKeys.parseKey")(function* (
  kid: string,
  base64UrlKey: string
) {
  const decodedKid = yield* Schema.decodeUnknownEffect(sealedStateKeyIdSchema)(
    kid
  ).pipe(
    Effect.mapError((cause) =>
      invalidSecret("Sealed state key ID is invalid.", cause)
    )
  );
  const key = yield* Effect.try({
    try: () => Buffer.from(base64UrlKey, "base64url"),
    catch: (cause) =>
      invalidSecret(
        "Sealed state encryption key is not valid base64url.",
        cause
      ),
  });

  if (key.byteLength !== keyByteLength) {
    return yield* invalidSecret(
      "Sealed state encryption keys must decode to 32 bytes."
    );
  }

  return { kid: decodedKid, key } satisfies SealedStateKey;
});
