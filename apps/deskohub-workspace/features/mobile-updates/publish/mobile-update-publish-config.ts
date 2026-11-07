import {
  Context,
  Data,
  Effect,
  Layer,
  Option,
  type Redacted,
  Schema,
} from "effect";

const Secret = Schema.RedactedFromValue(Schema.NonEmptyString);

/** The environment the publish script reads; CI passes each as a secret. */
const PublishEnvironment = Schema.Struct({
  /**
   * Read-write token of the public Blob store that holds update files; a
   * rollback stores no files and doesn't need it.
   */
  BLOB_READ_WRITE_TOKEN: Schema.optionalKey(Secret),
  /** The target deployment's publish token, which authorizes publishing. */
  MOBILE_UPDATES_PUBLISH_TOKEN: Secret,
  /**
   * Vercel's protection bypass for automation, needed when the target is a
   * protected preview deployment.
   */
  VERCEL_AUTOMATION_BYPASS_SECRET: Schema.optionalKey(Secret),
});

export class MobileUpdatePublishConfigInvalid extends Data.TaggedError(
  "MobileUpdatePublishConfigInvalid"
)<{ readonly message: string }> {}

interface IMobileUpdatePublishConfig {
  /** Origin of the deployment the update is published to. */
  readonly target: URL;
  readonly blobToken: Option.Option<Redacted.Redacted<string>>;
  readonly publishToken: Redacted.Redacted<string>;
  readonly protectionBypass: Option.Option<Redacted.Redacted<string>>;
}

/** Where a publish run publishes to, and the secrets it publishes with. */
export class MobileUpdatePublishConfig extends Context.Service<
  MobileUpdatePublishConfig,
  IMobileUpdatePublishConfig
>()("MobileUpdatePublishConfig") {
  /**
   * Reads the secrets from the process environment. An empty variable counts
   * as unset, since GitHub Actions passes a missing secret as one.
   */
  static Default = (target: URL) =>
    Layer.effect(
      this,
      Effect.gen(function* () {
        const environment = Object.fromEntries(
          Object.entries(process.env).filter(([, value]) => value)
        );
        if (environment.MOBILE_UPDATES_PUBLISH_TOKEN === undefined) {
          return yield* new MobileUpdatePublishConfigInvalid({
            message:
              "Set MOBILE_UPDATES_PUBLISH_TOKEN to publish to a deployment",
          });
        }

        const decoded = yield* Schema.decodeUnknownEffect(PublishEnvironment)(
          environment
        ).pipe(
          Effect.mapError(
            () =>
              new MobileUpdatePublishConfigInvalid({
                message: "The mobile update publish environment is invalid",
              })
          )
        );
        return {
          target,
          blobToken: Option.fromUndefinedOr(decoded.BLOB_READ_WRITE_TOKEN),
          publishToken: decoded.MOBILE_UPDATES_PUBLISH_TOKEN,
          protectionBypass: Option.fromUndefinedOr(
            decoded.VERCEL_AUTOMATION_BYPASS_SECRET
          ),
        };
      })
    );
}
