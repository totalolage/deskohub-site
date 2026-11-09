import type { ParaglideAsyncLocalStorage } from "../request-locale";

type TestRequest<Locale extends string> = { localeCookie?: Locale };

/**
 * Models the server-side locale behaviour of a compiled Paraglide runtime with
 * the `cookie`, `globalVariable`, `baseLocale` strategy: `setLocale` writes a
 * process-wide variable, and `getLocale` and `extractLocaleFromRequest` fall
 * back to it when no request-scoped locale exists.
 */
export function createTestParaglideRuntime<Locale extends string>(
  baseLocale: Locale
) {
  let globalLocale: Locale | undefined;
  let serverAsyncLocalStorage: ParaglideAsyncLocalStorage<Locale> | undefined;

  let getLocale = (): Locale =>
    serverAsyncLocalStorage?.getStore()?.locale ?? globalLocale ?? baseLocale;
  let setLocale = (locale: Locale, _options?: { reload?: boolean }): void => {
    globalLocale = locale;
  };

  return {
    baseLocale,
    getLocale: () => getLocale(),
    setLocale: (locale: Locale, options?: { reload?: boolean }) =>
      setLocale(locale, options),
    extractLocaleFromRequest: (request: TestRequest<Locale>): Locale =>
      request.localeCookie ?? globalLocale ?? baseLocale,
    overwriteGetLocale: (fn: () => Locale) => {
      getLocale = fn;
    },
    overwriteSetLocale: (
      fn: (locale: Locale, options?: { reload?: boolean }) => void
    ) => {
      setLocale = fn;
    },
    overwriteServerAsyncLocalStorage: (
      storage: ParaglideAsyncLocalStorage<Locale> | undefined
    ) => {
      serverAsyncLocalStorage = storage;
    },
  };
}
