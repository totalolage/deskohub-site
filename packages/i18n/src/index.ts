// Environment-neutral locale helpers. The Next.js middleware, next-safe-action,
// and Effect integrations have their own entry points, so this barrel is safe
// to import from any runtime.
export {
  isLocale,
  type LocaleConfig,
  normalizeLocaleTag,
  parseAcceptLanguage,
  resolveLocaleFromPolicy,
  resolvePreferredLocale,
} from "./core";
export {
  getLocaleFromPathname,
  getLocalizedPathVariants,
  parseLocalizedPathname,
  pathnameHasLocale,
  prefixPathnameWithLocale,
  replaceLocaleInPathname,
  stripLocaleFromPathname,
} from "./pathname";
export {
  getTranslatedValue,
  type TranslatableValue,
  type TranslatedRecord,
} from "./translatable";
