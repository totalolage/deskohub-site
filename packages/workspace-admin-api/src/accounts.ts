import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import {
  AdministrationDotyposCustomerId,
  CliBearerAuthentication,
  CliServiceUnavailable,
} from "./workspace-admin-api";

export const AdministrationAccountBackfillInput = Schema.Struct({
  /** Report what would change without writing. */
  dryRun: Schema.Boolean,
}).annotate({
  parseOptions: { errors: "all", onExcessProperty: "error" },
});
export type AdministrationAccountBackfillInput =
  typeof AdministrationAccountBackfillInput.Type;

/** Logins that got the durable customer account they lacked. */
export const AdministrationAccountBackfillLoginCounts = Schema.Struct({
  /** Accounts created, or that a dry run would create. */
  created: Schema.Int,
  alreadyPresent: Schema.Int,
});
export type AdministrationAccountBackfillLoginCounts =
  typeof AdministrationAccountBackfillLoginCounts.Type;

/** Dotypos links copied onto the linked account's own record. */
export const AdministrationAccountBackfillLinkCounts = Schema.Struct({
  /** Links recorded, or that a dry run would record. */
  recorded: Schema.Int,
  alreadyRecorded: Schema.Int,
  /**
   * Links left unchanged because the account is deleted, its record names
   * another customer, or another live account holds the customer.
   */
  conflicts: Schema.Int,
});
export type AdministrationAccountBackfillLinkCounts =
  typeof AdministrationAccountBackfillLinkCounts.Type;

/** Live accounts whose login no longer exists. */
export const AdministrationAccountBackfillTombstoneCounts = Schema.Struct({
  /** Accounts marked deleted, or that a dry run would mark. */
  recorded: Schema.Int,
  alreadyDeleted: Schema.Int,
  /**
   * Accounts without a login created within the last day, left alone because
   * their sign-up may still be inserting the login.
   */
  skippedRecent: Schema.Int,
});
export type AdministrationAccountBackfillTombstoneCounts =
  typeof AdministrationAccountBackfillTombstoneCounts.Type;

/** Customers given an author and the reservations they cover. */
export const AdministrationAccountBackfillAuthorCounts = Schema.Struct({
  customers: Schema.Int,
  reservations: Schema.Int,
});
export type AdministrationAccountBackfillAuthorCounts =
  typeof AdministrationAccountBackfillAuthorCounts.Type;

export const AdministrationAccountBackfillRefusalReason = Schema.Literals([
  "customer_not_found",
  "customer_deleted",
  "customer_expired",
  "email_missing",
  "email_invalid",
  "email_duplicated",
  "login_conflict",
  "link_conflict",
]);
export type AdministrationAccountBackfillRefusalReason =
  typeof AdministrationAccountBackfillRefusalReason.Type;

/** A Dotypos customer whose authorless reservations stay authorless. */
export const AdministrationAccountBackfillRefusal = Schema.Struct({
  dotyposCustomerId: AdministrationDotyposCustomerId,
  reason: AdministrationAccountBackfillRefusalReason,
  /** The customer's reservations that still have no author. */
  reservations: Schema.Int,
});
export type AdministrationAccountBackfillRefusal =
  typeof AdministrationAccountBackfillRefusal.Type;

export const AdministrationAccountBackfillAuthors = Schema.Struct({
  /** Reservations that already had an author before this request. */
  alreadyAuthored: Schema.Int,
  /** Authored by the account already linked to the customer. */
  viaLink: AdministrationAccountBackfillAuthorCounts,
  /** Authored by a new unverified login created for the customer's email. */
  viaNewLogin: AdministrationAccountBackfillAuthorCounts,
  /**
   * Authored by an unverified, unlinked login with the customer's email that
   * an interrupted earlier run left behind.
   */
  viaResumedLogin: AdministrationAccountBackfillAuthorCounts,
  refused: Schema.Array(AdministrationAccountBackfillRefusal),
  /**
   * Customers ready for an author that this request left for the next one.
   * Always 0 in a dry run, which reports every customer at once.
   */
  remainingCustomers: Schema.Int,
});
export type AdministrationAccountBackfillAuthors =
  typeof AdministrationAccountBackfillAuthors.Type;

/**
 * One request's report. Counts never carry emails or names; a refused
 * customer is named only by its Dotypos ID.
 */
export const AdministrationAccountBackfillReport = Schema.Struct({
  dryRun: Schema.Boolean,
  logins: AdministrationAccountBackfillLoginCounts,
  links: AdministrationAccountBackfillLinkCounts,
  tombstones: AdministrationAccountBackfillTombstoneCounts,
  authors: AdministrationAccountBackfillAuthors,
});
export type AdministrationAccountBackfillReport =
  typeof AdministrationAccountBackfillReport.Type;

export const AdminCliAccountsApi = HttpApiGroup.make("accounts")
  .add(
    HttpApiEndpoint.post("backfillAccounts", "/accounts/backfill", {
      payload: AdministrationAccountBackfillInput,
      success: AdministrationAccountBackfillReport,
      error: [CliServiceUnavailable.schema],
    })
  )
  .middleware(CliBearerAuthentication)
  .prefix("/api/v1/cli");
