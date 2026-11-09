import { AsyncLocalStorage } from "node:async_hooks";
import { cache } from "react";

export type ParaglideStore<Locale extends string = string> = {
  locale?: Locale;
  origin?: string;
  messageCalls?: Set<string>;
};

export type ParaglideAsyncLocalStorage<Locale extends string = string> = {
  getStore(): ParaglideStore<Locale> | undefined;
  run: (store: ParaglideStore<Locale>, callback: unknown) => unknown;
};

type CreateRequestLocaleScopeOptions<Locale extends string> = {
  origin?: string;
  overwriteServerAsyncLocalStorage: (
    storage: ParaglideAsyncLocalStorage<Locale> | undefined
  ) => void;
};

/**
 * Owns the AsyncLocalStorage that Paraglide's `getLocale()` reads first on the
 * server. A locale run through the scope reaches message functions for that
 * callback and its async continuations only, so overlapping requests never
 * share it. Create one scope per Paraglide runtime: Paraglide keeps only the
 * last registered storage.
 */
export function createRequestLocaleScope<Locale extends string>({
  origin,
  overwriteServerAsyncLocalStorage,
}: CreateRequestLocaleScopeOptions<Locale>) {
  const storage = new AsyncLocalStorage<ParaglideStore<Locale>>();

  overwriteServerAsyncLocalStorage(
    storage as unknown as ParaglideAsyncLocalStorage<Locale>
  );

  return {
    getLocale: (): Locale | undefined => storage.getStore()?.locale,
    runWithLocale: <A>(
      locale: Locale,
      callback: () => A | Promise<A>
    ): Promise<A> => storage.run({ locale, origin }, async () => callback()),
  };
}

export type RequestLocaleScope<Locale extends string> = ReturnType<
  typeof createRequestLocaleScope<Locale>
>;

type AmbientLocaleRuntime<Locale extends string> = {
  baseLocale: Locale;
  overwriteGetLocale: (getLocale: () => Locale) => void;
  overwriteSetLocale: (setLocale: (locale: Locale) => void) => void;
};

type RenderLocaleStore<Locale extends string> = { locale?: Locale };

/**
 * Replaces Paraglide's process-wide locale variable on the server, for apps
 * whose server components call `setLocale()` and then read messages without
 * an explicit `{ locale }`. `setLocale()` records the locale for the current
 * React Server Components render (React `cache` is request-scoped), and
 * `getLocale()` prefers the scope's locale, then that render's locale, then
 * the base locale. No request can observe a locale another request set.
 *
 * Install it only in server-only modules: client components keep Paraglide's
 * browser behaviour.
 */
export function scopeAmbientLocaleToRequest<Locale extends string>(
  scope: Pick<RequestLocaleScope<Locale>, "getLocale">,
  runtime: AmbientLocaleRuntime<Locale>,
  getRenderLocaleStore: () => RenderLocaleStore<Locale> = cache(
    (): RenderLocaleStore<Locale> => ({})
  )
) {
  runtime.overwriteGetLocale(
    () =>
      scope.getLocale() ?? getRenderLocaleStore().locale ?? runtime.baseLocale
  );
  runtime.overwriteSetLocale((locale) => {
    getRenderLocaleStore().locale = locale;
  });
}
