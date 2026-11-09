/**
 * The English display name of a Dotypos customer without a name. The
 * administration API and `dhw` return it as is; screens localize it.
 */
export const unnamedCustomerDisplayName = "Unnamed customer";

/** A customer's display name, and whether Dotypos holds one so the Admin UI can name an unnamed customer in the operator's language. */
export type AdministrationCustomerName = {
  readonly displayName: string;
  readonly hasName: boolean;
};
