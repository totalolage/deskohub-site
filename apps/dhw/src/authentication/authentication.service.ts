import type {
  CliAccessTokenType,
  CliServiceUnavailable,
  CliSessionType,
} from "@deskohub/workspace-admin-api";
import { Context, Effect, Layer, Option, Redacted } from "effect";
import {
  type CliApiRequestError,
  WorkspaceAdminApiClient,
} from "../api/workspace-admin-api-client.service";
import { CliSessionCredential } from "../credentials/cli-session-credential.service";
import type { CredentialStoreError } from "../credentials/credential-store.service";

export type AuthorizedCliSession = {
  readonly accessToken: Redacted.Redacted<CliAccessTokenType>;
  readonly session: CliSessionType;
};

interface IAuthenticationService {
  readonly current: Effect.Effect<
    Option.Option<AuthorizedCliSession>,
    CliApiRequestError | CliServiceUnavailable | CredentialStoreError
  >;
  readonly save: (
    token: CliAccessTokenType
  ) => Effect.Effect<void, CredentialStoreError>;
  readonly clear: Effect.Effect<boolean, CredentialStoreError>;
}

export class AuthenticationService extends Context.Service<
  AuthenticationService,
  IAuthenticationService
>()("AuthenticationService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const api = yield* WorkspaceAdminApiClient;
      const credential = yield* CliSessionCredential;

      const current = Effect.gen(function* () {
        const accessToken = yield* credential.get;
        if (!accessToken) return Option.none<AuthorizedCliSession>();

        return yield* api.getCurrentSession(accessToken).pipe(
          Effect.map((session) =>
            Option.some({ accessToken, session } satisfies AuthorizedCliSession)
          ),
          Effect.catchTag("CliSessionUnauthorized", () =>
            credential.remove.pipe(
              Effect.as(Option.none<AuthorizedCliSession>())
            )
          )
        );
      });

      return {
        current,
        save: Effect.fn("AuthenticationService.save")((token) =>
          credential.set(Redacted.make(token))
        ),
        clear: credential.remove,
      } satisfies IAuthenticationService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(WorkspaceAdminApiClient.Default),
    Layer.provide(CliSessionCredential.Live)
  );
}
