import { AsyncLocalStorage } from "node:async_hooks";
import { Context, Effect } from "effect";

export type ParaglideStore<Locale extends string = string> = {
  locale?: Locale;
  origin?: string;
  messageCalls?: Set<string>;
};

export type ParaglideAsyncLocalStorage<Locale extends string = string> = {
  getStore(): ParaglideStore<Locale> | undefined;
  run: (store: ParaglideStore<Locale>, callback: unknown) => unknown;
};

type CreateParaglideLocaleBridgeOptions<Locale extends string, LocaleTag> = {
  localeTag: Context.Service<LocaleTag, Locale>;
  origin: string;
  setLocale: (locale: Locale, options?: { reload?: boolean }) => unknown;
  overwriteServerAsyncLocalStorage: (
    storage: ParaglideAsyncLocalStorage<Locale> | undefined
  ) => void;
};

export function createParaglideLocaleBridge<Locale extends string, LocaleTag>({
  localeTag,
  origin,
  setLocale,
  overwriteServerAsyncLocalStorage,
}: CreateParaglideLocaleBridgeOptions<Locale, LocaleTag>) {
  const localeAsyncLocalStorage = new AsyncLocalStorage<
    ParaglideStore<Locale>
  >();

  overwriteServerAsyncLocalStorage(
    localeAsyncLocalStorage as unknown as ParaglideAsyncLocalStorage<Locale>
  );

  const runWithLocale = Effect.fn(function* <A>(
    next: Effect.Effect<A, never, LocaleTag>
  ) {
    const locale = yield* localeTag;
    setLocale(locale, { reload: false });

    const nextWithLocale = next.pipe(Effect.provideService(localeTag, locale));

    return yield* Effect.promise((signal) =>
      localeAsyncLocalStorage.run({ locale, origin }, () =>
        Effect.runPromise(nextWithLocale, { signal })
      )
    );
  });

  return {
    localeAsyncLocalStorage,
    runWithLocale,
  };
}
