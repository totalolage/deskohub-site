export { getWorkspaceAlternates } from "./alternates";
export type { LocalizedCopy } from "./localized-copy";
export { getWorkspacePageUrl } from "./page-url";
// Re-export the message modules directly; Turbopack drops unused messages only
// when `m` is a namespace re-export, not a re-exported binding.
export * as m from "./paraglide/messages/_index.js";
export {
  baseLocale,
  isLocale,
  type Locale,
  locales,
} from "./paraglide/runtime.js";
export {
  defaultLocale,
  getLocalizedPagePath,
  getUnprefixedPagePath,
  type StaticLocalizedPageRoute,
  withLocalePrefixAndSearch,
} from "./routing";
