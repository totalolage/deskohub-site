export { LanguageSwitcher } from "./components/language-switcher";
export { LocalizedLink } from "./components/localized-link";

// Re-export Paraglide runtime and messages
export { m } from "./paraglide/messages.js";
export {
  assertIsLocale,
  baseLocale,
  extractLocaleFromRequest,
  getLocale,
  isLocale,
  type Locale,
  locales,
  overwriteGetLocale,
  setLocale,
} from "./paraglide/runtime.js";
