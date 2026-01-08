import { NextMiddleware } from "@mcrovero/effect-nextjs";
import { NotFound } from "@mcrovero/effect-nextjs/Navigation";
import { Context, Data, Effect, Layer, Schema } from "effect";
import { env } from "@/env";
import { type Locale, locales, setLocale } from "@/features/i18n";
import { localeAsyncLocalStorage } from "../i18n/utils/setup-server";

export class LocaleValue extends Context.Tag("Locale")<LocaleValue, Locale>() {}

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
    const paramsUnknown = yield* Effect.promise(() => paramsPromise);
    const params = yield* Schema.decodeUnknown(schema)(paramsUnknown);
    return params;
  },
  (effect, input) =>
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
        input,
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

        const nextWithLocale = next.pipe(
          Effect.provideService(LocaleValue, locale)
        );

        return yield* Effect.promise(
          localeAsyncLocalStorage.run(
            {
              locale,
              origin: env.NEXT_PUBLIC_DOMAIN,
            },
            () => () => Effect.runPromise(nextWithLocale)
          )
        );
      },
      (effect, input) =>
        effect.pipe(
          Effect.tapError(
            Effect.fn(function* (error) {
              yield* Effect.logError(error);
            })
          ),
          Effect.annotateLogs({
            operation: "LocaleMiddlewareLive",
            input,
          }),
          Effect.orElse(() => NotFound)
        )
    )
  )
);
