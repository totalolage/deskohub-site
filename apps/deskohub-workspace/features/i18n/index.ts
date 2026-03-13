export { LanguageSwitcher } from "./components/language-switcher";
export { m } from "./paraglide/messages.js";
export {
  baseLocale,
  getLocale,
  isLocale,
  type Locale,
  locales,
  setLocale,
} from "./paraglide/runtime.js";
export {
  defaultWorkspaceLocale,
  getLocaleFromPathname,
  getPreferredLocaleFromAcceptLanguage,
  isWorkspaceLocale,
  resolveLocaleFromPolicy,
  type WorkspaceLocale,
  withLocalePrefix,
  workspaceLocaleConfig,
  workspaceLocaleCookieName,
  workspaceLocales,
} from "./routing";
