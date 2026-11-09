import { type Context, Effect } from "effect";
import type { RequestLocaleScope } from "./request-locale";

type CreateParaglideLocaleBridgeOptions<Locale extends string, LocaleTag> = {
  localeTag: Context.Service<LocaleTag, Locale>;
  scope: Pick<RequestLocaleScope<Locale>, "runWithLocale">;
};

export function createParaglideLocaleBridge<Locale extends string, LocaleTag>({
  localeTag,
  scope,
}: CreateParaglideLocaleBridgeOptions<Locale, LocaleTag>) {
  const runWithLocale = Effect.fn(function* <A>(
    next: Effect.Effect<A, never, LocaleTag>
  ) {
    const locale = yield* localeTag;
    const context = yield* Effect.context<LocaleTag>();

    return yield* Effect.promise((signal) =>
      scope.runWithLocale(locale, () =>
        Effect.runPromiseWith(context)(next, { signal })
      )
    );
  });

  return { runWithLocale };
}
