/**
 * The signed-in account's analytics preference, as its account preferences
 * show it: granted when the account's current decision is a grant, under any
 * privacy notice; not granted when it is a withdrawal or the account never
 * decided. Unavailable when the account's decisions couldn't be read, which
 * is never shown as not granted. None for a signed-out visitor.
 */
export type AnalyticsPreferenceState =
  | { readonly status: "signed-out" }
  | { readonly status: "unavailable" }
  | { readonly status: "available"; readonly granted: boolean };
