import { Data, Effect, Schema } from "effect";
import { locales } from "@/features/i18n";

export { LocaleValue } from "@/features/localization/locale-value";

const ParamsSchema = Schema.Struct({
  locale: Schema.Literals(locales),
});

const ArgsSchema = Schema.Struct({
  params: Schema.Unknown,
});

class MiddlewarePropsError extends Data.TaggedError("MiddlewarePropsError")<{
  readonly cause?: unknown;
  readonly message: string;
}> {}

export const parseLocaleProps = Effect.fn("parseLocaleProps")(
  function* (props: unknown) {
    yield* Effect.logDebug("Parsing middleware props");

    const { params: paramsPromise } =
      yield* Schema.decodeUnknownEffect(ArgsSchema)(props);
    const paramsUnknown = yield* Effect.promise(() =>
      Promise.resolve(paramsPromise)
    );
    const params =
      yield* Schema.decodeUnknownEffect(ParamsSchema)(paramsUnknown);
    return params;
  },
  (effect) =>
    effect.pipe(
      Effect.mapError(
        (error) =>
          new MiddlewarePropsError({
            message: "Failed to parse middleware props",
            cause: error,
          })
      ),
      Effect.annotateLogs({
        operation: "parseLocaleProps",
      })
    )
);
