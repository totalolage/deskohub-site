/**
 * The app's copy, compiled by Paraglide from `messages/*.json`
 * (`bun run i18n:compile`). Pass the locale on every call,
 * `m.home_title({}, { locale })`: the runtime's own detection strategies read
 * cookies, URLs and `window`, which don't exist on native.
 */
export { m } from "./paraglide/messages.js";
