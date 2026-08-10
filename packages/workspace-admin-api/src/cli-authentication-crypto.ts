import { Crypto, Effect, Encoding } from "effect";
import type {
  CliAuthenticationChallenge,
  CliAuthenticationVerifier,
} from "./workspace-admin-api";

const encoder = new TextEncoder();

export const makeCliAuthenticationSecret = Effect.fn(
  "CliAuthenticationCrypto.makeSecret"
)(function* () {
  const crypto = yield* Crypto.Crypto;
  return Encoding.encodeBase64Url(yield* crypto.randomBytes(32));
});

export const digestCliAuthenticationSecret = Effect.fn(
  "CliAuthenticationCrypto.digestSecret"
)(function* (secret: string) {
  const crypto = yield* Crypto.Crypto;
  return Encoding.encodeBase64Url(
    yield* crypto.digest("SHA-256", encoder.encode(secret))
  );
});

export const makeCliAuthenticationVerifier = makeCliAuthenticationSecret().pipe(
  Effect.map((secret) => secret as CliAuthenticationVerifier)
);

export const makeCliAuthenticationChallenge = Effect.fn(
  "CliAuthenticationCrypto.makeChallenge"
)((verifier: CliAuthenticationVerifier) =>
  digestCliAuthenticationSecret(verifier).pipe(
    Effect.map((digest) => digest as CliAuthenticationChallenge)
  )
);
