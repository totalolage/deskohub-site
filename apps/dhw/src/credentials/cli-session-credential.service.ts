import {
  CliAccessToken,
  type CliAccessTokenType,
} from "@deskohub/workspace-admin-api";
import { Context, Effect, Layer, Redacted, Schema } from "effect";
import { DhwConfig } from "../config/dhw-config.service";
import {
  CredentialStore,
  type CredentialStoreError,
} from "./credential-store.service";

interface ICliSessionCredential {
  readonly get: Effect.Effect<
    Redacted.Redacted<CliAccessTokenType> | undefined,
    CredentialStoreError
  >;
  readonly set: (
    token: Redacted.Redacted<CliAccessTokenType>
  ) => Effect.Effect<void, CredentialStoreError>;
  readonly remove: Effect.Effect<boolean, CredentialStoreError>;
}

export class CliSessionCredential extends Context.Service<
  CliSessionCredential,
  ICliSessionCredential
>()("CliSessionCredential") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const config = yield* DhwConfig;
      const store = yield* CredentialStore;
      const credentialName = `access-token:${config.baseUrl.origin}`;
      const get = store.get(credentialName).pipe(
        Effect.flatMap((token) =>
          token
            ? Schema.decodeUnknownEffect(CliAccessToken)(
                Redacted.value(token)
              ).pipe(Effect.map(Redacted.make))
            : Effect.succeed(undefined)
        ),
        Effect.catchTag("SchemaError", () =>
          store.remove(credentialName).pipe(Effect.as(undefined))
        )
      );

      return {
        get,
        set: Effect.fn("CliSessionCredential.set")((token) =>
          store.set(credentialName, token)
        ),
        remove: store.remove(credentialName),
      } satisfies ICliSessionCredential;
    })
  );

  static LiveWithDependencies = this.Live.pipe(
    Layer.provide(CredentialStore.Live)
  );
}
