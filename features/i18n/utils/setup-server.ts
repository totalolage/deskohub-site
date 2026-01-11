import { AsyncLocalStorage } from "node:async_hooks";
import { Effect } from "effect";
import { env } from "@/env";
import { LocaleValue } from "@/features/localization/effect-locale";
import {
  overwriteServerAsyncLocalStorage,
  type ParaglideAsyncLocalStorage,
  setLocale,
} from "../paraglide/runtime";

const localeAsyncLocalStorage = new AsyncLocalStorage<
  NonNullable<ReturnType<ParaglideAsyncLocalStorage["getStore"]>>
>();

overwriteServerAsyncLocalStorage(localeAsyncLocalStorage);

export const runAppWithLocale = Effect.fn(function* <O>(
  next: Effect.Effect<O, never, LocaleValue>
) {
  const locale = yield* LocaleValue;
  setLocale(locale, { reload: false });

  const nextWithLocale = next.pipe(Effect.provideService(LocaleValue, locale));

  return yield* Effect.promise(
    localeAsyncLocalStorage.run(
      {
        locale,
        origin: env.NEXT_PUBLIC_DOMAIN,
      },
      () => (signal) => Effect.runPromise(nextWithLocale, { signal })
    )
  );
});
