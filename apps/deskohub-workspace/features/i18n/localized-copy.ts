import type { Locale } from "./paraglide/runtime.js";

/**
 * Copy in a locale, called like an `m.*` message without inputs, so a
 * message passes as is.
 */
export type LocalizedCopy = (
  inputs: Record<string, never>,
  options: { readonly locale: Locale }
) => string;
