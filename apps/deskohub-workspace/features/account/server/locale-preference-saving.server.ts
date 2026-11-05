import "server-only";

import { updateLocalePreference } from "@/features/account/actions";
import { isCustomerSignedIn } from "@/features/account/server/customer-session.server";
import type { LocalePreferenceSaving } from "@/features/account/switch-locale";

/**
 * The preference saving a locale switcher needs, for the site headers and the
 * administration. The session check is not awaited: the switcher learns after
 * the shell whether a switch must save the signed-in customer's preference, and
 * a failed check reads as a guest.
 */
export const createLocalePreferenceSaving = (): LocalePreferenceSaving => ({
  signedIn: isCustomerSignedIn().catch(() => false),
  save: updateLocalePreference,
});
