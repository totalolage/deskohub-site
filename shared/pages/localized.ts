// lib/auth-runtime.ts

import { Next, NextMiddleware } from "@mcrovero/effect-nextjs";
import { NotFound } from "@mcrovero/effect-nextjs/Navigation";
import { Context, Effect, Either, Layer, Schema } from "effect";
import type { ReactNode } from "react";
import { type Locale, locales, setLocale } from "@/features/i18n";
import { localeAsyncLocalStorage } from "@/features/i18n/utils/setup-server";

export class EffectLocale extends Context.Tag("Locale")<
  EffectLocale,
  Locale
>() {}

export class LocalizationMiddleware extends NextMiddleware.Tag<LocalizationMiddleware>()(
  "LocalizationMiddleware",
  {
    provides: EffectLocale,
    wrap: true,
    options: {},
  }
) {}

const LocaleSchema = Schema.Struct({
  locale: Schema.Literal(...locales),
});

// Live implementation for the middleware
export const LocalizationLive = Layer.succeed(
  LocalizationMiddleware,
  LocalizationMiddleware.of(
    Effect.fn("LocalizationLive")(function* ({ props, next }) {
      const params = yield* Effect.promise(
        () => (props as [PageProps<"/[locale]">])[0].params
      );
      const localeResult = Schema.decodeUnknownEither(LocaleSchema)(params);

      if (Either.isLeft(localeResult)) {
        console.error("Failed to parse locale from props", {
          props,
          error: localeResult.left,
        });
        Effect.logError("Failed to parse locale from props", {
          props,
          error: localeResult.left,
        });
        return yield* NotFound;
      }

      const { locale } = localeResult.right;
      setLocale(locale, { reload: false });

      return yield* Effect.promise(
        localeAsyncLocalStorage.run(
          {
            locale,
            origin:
              process.env.NEXT_PUBLIC_BASE_URL ||
              `http://localhost:${process.env.PORT || 3000}`,
          },
          () => () =>
            Effect.runPromise(Effect.provideService(next, EffectLocale, locale))
        )
      );
    })
  )
);

export const LocalizedPage = Next.make(
  "LocalizedPage",
  LocalizationLive
).middleware(LocalizationMiddleware);

export type LocalizedPage = () => Effect.Effect<
  ReactNode,
  never,
  LocalizationMiddleware
>;
