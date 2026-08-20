import {
  Config,
  Context,
  Data,
  Effect,
  Layer,
  Option,
  Path,
  type Redacted,
  Schema,
} from "effect";

const productionOrigin = new URL("https://workspace.deskohub.cz");
const managedRequestHeaders = new Set([
  "authorization",
  "content-length",
  "content-type",
  "host",
]);

const RequestHeaders = Schema.fromJsonString(
  Schema.Record(
    Schema.String,
    Schema.RedactedFromValue(Schema.String, { disallowEncode: true })
  )
);

interface IDhwConfig {
  readonly baseUrl: URL;
  readonly requestHeaders: Readonly<Record<string, Redacted.Redacted<string>>>;
  readonly isCi: boolean;
  readonly stateDirectory: string;
  readonly updateChecksDisabled: boolean;
}

export class DhwConfig extends Context.Service<DhwConfig, IDhwConfig>()(
  "DhwConfig"
) {
  static Default = Layer.effect(
    this,
    Effect.suspend(() => loadDhwConfig)
  );
}

export class DhwConfigError extends Data.TaggedError("DhwConfigError")<{
  readonly message: string;
}> {}

const loadDhwConfig = Effect.gen(function* () {
  const path = yield* Path.Path;
  const baseUrl = yield* Config.url("DHW_BASE").pipe(
    Config.withDefault(productionOrigin)
  );
  const requestHeaders = yield* Config.schema(
    RequestHeaders,
    "DHW_REQUEST_HEADERS"
  ).pipe(Config.withDefault({}));
  const isCi = yield* Config.boolean("CI").pipe(Config.withDefault(false));
  const stateDirectoryOverride = yield* Config.option(
    Config.nonEmptyString("DHW_STATE_DIR")
  );
  const stateDirectory = yield* Option.match(stateDirectoryOverride, {
    onNone: () =>
      Config.nonEmptyString("HOME").pipe(
        Effect.map((homeDirectory) =>
          path.join(homeDirectory, ".local", "state", "dhw")
        )
      ),
    onSome: (directory) => Effect.succeed(directory),
  });
  const updateChecksDisabled = yield* Config.boolean(
    "DHW_NO_UPDATE_CHECK"
  ).pipe(Config.withDefault(false));

  yield* validateBaseUrl(baseUrl);
  yield* validateRequestHeaders(requestHeaders);

  return {
    baseUrl,
    requestHeaders,
    isCi,
    stateDirectory,
    updateChecksDisabled,
  };
});

const validateBaseUrl = (baseUrl: URL) => {
  const isLocalHttp =
    baseUrl.protocol === "http:" &&
    (baseUrl.hostname === "localhost" || baseUrl.hostname === "127.0.0.1");
  const isOrigin = baseUrl.pathname === "/" && !baseUrl.search && !baseUrl.hash;

  return isOrigin && (baseUrl.protocol === "https:" || isLocalHttp)
    ? Effect.void
    : Effect.fail(
        new DhwConfigError({
          message:
            "DHW_BASE must be an HTTPS origin, or an HTTP localhost origin.",
        })
      );
};

const validateRequestHeaders = (
  requestHeaders: Readonly<Record<string, Redacted.Redacted<string>>>
) => {
  const managedHeader = Object.keys(requestHeaders).find((name) =>
    managedRequestHeaders.has(name.toLowerCase())
  );

  return managedHeader === undefined
    ? Effect.void
    : Effect.fail(
        new DhwConfigError({
          message: `DHW_REQUEST_HEADERS cannot set the managed ${managedHeader} header.`,
        })
      );
};
