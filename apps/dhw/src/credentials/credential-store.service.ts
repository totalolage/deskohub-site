import {
  Config,
  Context,
  Data,
  Effect,
  Layer,
  MutableHashMap,
  Option,
  Redacted,
} from "effect";

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
  /** The operating-system credential store: macOS Keychain or Linux Secret Service. */
  static system = Layer.succeed(this, {
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

  /** Credentials that live only as long as the process, for isolated runs. */
  static memory = Layer.sync(this, () => {
    const credentials = MutableHashMap.empty<
      string,
      Redacted.Redacted<string>
    >();

    return {
      get: (name: string) =>
        Effect.sync(() =>
          Option.getOrUndefined(MutableHashMap.get(credentials, name))
        ),
      set: (name: string, value: Redacted.Redacted<string>) =>
        Effect.sync(() => {
          MutableHashMap.set(credentials, name, value);
        }),
      remove: (name: string) =>
        Effect.sync(() => {
          const existed = MutableHashMap.has(credentials, name);
          MutableHashMap.remove(credentials, name);
          return existed;
        }),
    };
  });

  /** `DHW_CREDENTIAL_STORE=memory` keeps a run away from the shared store. */
  static Default = Layer.unwrap(
    Effect.gen(function* () {
      const store = yield* Config.literals(
        ["system", "memory"],
        "DHW_CREDENTIAL_STORE"
      ).pipe(Config.withDefault("system"));

      return store === "memory"
        ? CredentialStore.memory
        : CredentialStore.system;
    })
  );
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
