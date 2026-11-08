import { Context, Data, Effect, Layer } from "effect";
import * as Crypto from "expo-crypto";

/** The platform's random source or digest failed. */
export class AuthCryptoFailure extends Data.TaggedError("AuthCryptoFailure")<{
  readonly cause: unknown;
}> {}

interface IAuthCrypto {
  readonly randomBytes: (
    count: number
  ) => Effect.Effect<Uint8Array, AuthCryptoFailure>;
  /** SHA-256 of an ASCII string, such as a PKCE verifier. */
  readonly sha256: (
    ascii: string
  ) => Effect.Effect<Uint8Array, AuthCryptoFailure>;
}

/** Cryptographic randomness and hashing for the PKCE handoff. */
export class AuthCrypto extends Context.Service<AuthCrypto, IAuthCrypto>()(
  "deskohub-mobile/AuthCrypto"
) {
  static Live = Layer.succeed(this, {
    randomBytes: (count) =>
      Effect.try({
        try: () => Crypto.getRandomBytes(count),
        catch: (cause) => new AuthCryptoFailure({ cause }),
      }),
    sha256: (ascii) =>
      Effect.tryPromise({
        try: () =>
          Crypto.digest(
            Crypto.CryptoDigestAlgorithm.SHA256,
            Uint8Array.from(ascii, (character) => character.charCodeAt(0))
          ),
        catch: (cause) => new AuthCryptoFailure({ cause }),
      }).pipe(Effect.map((digest) => new Uint8Array(digest))),
  });
}
