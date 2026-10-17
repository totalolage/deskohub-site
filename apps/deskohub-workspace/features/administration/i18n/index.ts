// Administration copy compiles from its own Inlang project into its own
// Paraglide output. Only that separation keeps it out of the client chunk every
// customer route loads; never re-export it from `@/features/i18n`.
export * as m from "./paraglide/messages/_index.js";
