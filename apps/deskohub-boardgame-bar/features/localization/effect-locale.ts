import { NextMiddleware } from "@mcrovero/effect-nextjs";
import { Data, Effect, Layer, Schema } from "effect";
import { baseLocale, locales, setLocale } from "@/features/i18n";
import { LocaleValue } from "@/features/localization/locale-value";
import { runAppWithLocale } from "../i18n/utils/setup-server";

export { LocaleValue } from "@/features/localization/locale-value";

const PromiseSchema = Schema.declare(
  (input: unknown): input is Promise<unknown> =>
    typeof input === "object" &&
    input !== null &&
    "then" in input &&
    typeof input.then === "function",

  {
    identifier: "Promise",
    description: "Promise",
  }
);
const ParamsSchema = Schema.Struct({
  locale: Schema.Literal(...locales),
});

const ArgsSchema = Schema.Tuple(
  [
    Schema.Struct({
      params: PromiseSchema,
    }),
  ],
  Schema.Unknown
);

class MiddlewarePropsError extends Data.TaggedError("MiddlewarePropsError")<{
  readonly cause?: unknown;
  readonly message: string;
}> {}

const ParseMiddlewareProps = Effect.fn("ParseMiddlewareProps")(
  function* <A>(props: unknown, schema: Schema.Schema<A>) {
    yield* Effect.log("Parsing middleware props");

    const [{ params: paramsPromise }] =
      yield* Schema.decodeUnknown(ArgsSchema)(props);
    const paramsUnknown = yield* Effect.promise(() =>
      Promise.resolve(paramsPromise)
    );
    const params = yield* Schema.decodeUnknown(schema)(paramsUnknown);
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
        operation: "ParseMiddlewareProps",
      })
    )
);

export class LocaleMiddleware extends NextMiddleware.Tag<LocaleMiddleware>()(
  "LocaleMiddleware",
  {
    provides: LocaleValue,
    failure: Schema.Never,
    wrap: true,
  }
) {}

export const LocaleMiddlewareLive = Layer.succeed(
  LocaleMiddleware,
  LocaleMiddleware.of(
    Effect.fn("LocaleMiddlewareLive")(
      function* ({ props, next }) {
        yield* Effect.log("LocaleMiddlewareLive");

        const { locale } = yield* ParseMiddlewareProps(props, ParamsSchema);

        setLocale(locale, { reload: false });
        return yield* runAppWithLocale(next).pipe(
          Effect.provideService(LocaleValue, locale)
        );
      },
      (effect, input) =>
        effect.pipe(
          Effect.orElse(() => {
            setLocale(baseLocale, { reload: false });
            return runAppWithLocale(input.next).pipe(
              Effect.provideService(LocaleValue, baseLocale)
            );
          }),
          Effect.tapError(Effect.logError),
          Effect.annotateLogs({
            operation: "LocaleMiddlewareLive",
          })
        )
    )
  )
);
