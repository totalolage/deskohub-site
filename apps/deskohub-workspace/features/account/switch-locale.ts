import { type Locale, withLocalePrefixAndSearch } from "@/features/i18n";

/**
 * Saves a signed-in customer's locale preference when they switch locale.
 * Their saved preference decides the site locale, so a switch that skipped it
 * would be redirected straight back.
 */
export type LocalePreferenceSaving = {
  /**
   * Resolves `true` for a signed-in customer. The header streams it after the
   * shell, and React hands it to the client as a bare thenable, so use only
   * `then`.
   */
  readonly signedIn: PromiseLike<boolean>;
  /** The locked, deletion-rechecked `updateLocalePreference` Server Action. */
  readonly save: (input: { readonly locale: Locale }) => PromiseLike<unknown>;
};

/**
 * Switches the site to `locale` with a document navigation to the current page
 * under it. A signed-in customer's preference is saved first, and the
 * navigation follows whether or not the save succeeded. The header switcher
 * and the profile's language control both switch through here.
 */
export const switchLocale = async (
  locale: Locale,
  { save, signedIn }: LocalePreferenceSaving
): Promise<void> => {
  const isSignedIn = await Promise.resolve(signedIn).catch(() => false);
  if (isSignedIn) {
    await Promise.resolve(save({ locale })).catch(() => undefined);
  }
  const { pathname, search } = window.location;
  window.location.assign(withLocalePrefixAndSearch(pathname, locale, search));
};
