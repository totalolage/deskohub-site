import { Context, Data, Effect, Layer, Redacted } from "effect";

const credentialService = "cz.deskohub.workspace.cli";

interface ICredentialStore {
  readonly get: (
    name: string
  ) => Effect.Effect<
    Redacted.Redacted<string> | undefined,
    CredentialStoreError
  >;
  readonly set: (
    name: string,
    value: Redacted.Redacted<string>
  ) => Effect.Effect<void, CredentialStoreError>;
  readonly remove: (
    name: string
  ) => Effect.Effect<boolean, CredentialStoreError>;
}

export class CredentialStore extends Context.Service<
  CredentialStore,
  ICredentialStore
>()("CredentialStore") {
  static Live = Layer.succeed(this, {
    get: Effect.fn("CredentialStore.get")((name: string) =>
      Effect.tryPromise({
        try: () => Bun.secrets.get({ service: credentialService, name }),
        catch: CredentialStoreError.fromPlatform("read"),
      }).pipe(
        Effect.map((value) =>
          value === null ? undefined : Redacted.make(value)
        )
      )
    ),
    set: Effect.fn("CredentialStore.set")(
      (name: string, value: Redacted.Redacted<string>) =>
        Effect.tryPromise({
          try: () =>
            Bun.secrets.set({
              service: credentialService,
              name,
              value: Redacted.value(value),
            }),
          catch: CredentialStoreError.fromPlatform("write"),
        })
    ),
    remove: Effect.fn("CredentialStore.remove")((name: string) =>
      Effect.tryPromise({
        try: () => Bun.secrets.delete({ service: credentialService, name }),
        catch: CredentialStoreError.fromPlatform("delete"),
      })
    ),
  });
}

export class CredentialStoreError extends Data.TaggedError(
  "CredentialStoreError"
)<{
  readonly operation: "read" | "write" | "delete";
  readonly message: string;
  readonly cause: unknown;
}> {
  static fromPlatform =
    (operation: CredentialStoreError["operation"]) => (cause: unknown) =>
      new CredentialStoreError({
        operation,
        message:
          "The operating-system credential store is unavailable. On Linux, install libsecret and run a Secret Service provider.",
        cause,
      });
}
