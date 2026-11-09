import type { Href, ImperativeRouter } from "expo-router";

/** The Account tab's root: its index, the list of sections. */
export const accountRootHref = "/account" as const satisfies Href;

/**
 * Leaves an Account section for the Account root, such as after "Continue"
 * on a completed profile: back down the Account stack to its index, which
 * the stack's anchor keeps below every section, so the root shows no back
 * arrow. Not a replace: that swaps the section for a second index above
 * the anchored one, with a back arrow to the first.
 */
export const returnToAccountRoot = (
  router: Pick<ImperativeRouter, "dismissTo">
) => router.dismissTo(accountRootHref);
