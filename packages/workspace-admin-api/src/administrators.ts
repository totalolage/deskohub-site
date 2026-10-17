import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import {
  AdministrationLegacyUsername,
  CliBearerAuthentication,
  CliResourceNotFound,
  CliServiceUnavailable,
} from "./workspace-admin-api";

/** The login email of an existing Workspace account. */
export const AdministrationAccountEmail = Schema.Trim.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(255),
  Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
).annotate({
  identifier: "AdministrationAccountEmail",
  description: "Login email of an existing Workspace account.",
});
export type AdministrationAccountEmail = typeof AdministrationAccountEmail.Type;

export const AdministrationLegacyAdministratorBackfillInput = Schema.Struct({
  /** The Basic-auth username whose records move to the account. */
  legacyUsername: AdministrationLegacyUsername,
  email: AdministrationAccountEmail,
  /** Report what would change without writing. */
  dryRun: Schema.Boolean,
}).annotate({
  parseOptions: { errors: "all", onExcessProperty: "error" },
});
export type AdministrationLegacyAdministratorBackfillInput =
  typeof AdministrationLegacyAdministratorBackfillInput.Type;

/** How one table's legacy-username records relate to the target account. */
export const AdministrationLegacyActorRecordCounts = Schema.Struct({
  /** Records linked to the account, or that a dry run would link. */
  linked: Schema.Int,
  alreadyLinked: Schema.Int,
  /** Records already linked to a different account, left unchanged. */
  linkedToOtherAccount: Schema.Int,
});
export type AdministrationLegacyActorRecordCounts =
  typeof AdministrationLegacyActorRecordCounts.Type;

export const AdministrationLegacyAdministratorBackfillResult = Schema.Struct({
  dryRun: Schema.Boolean,
  /** `granted` in a dry run means the run would grant the role. */
  administratorRole: Schema.Literals(["granted", "already_granted"]),
  cliSessions: AdministrationLegacyActorRecordCounts,
  manualInvoices: AdministrationLegacyActorRecordCounts,
  standaloneAccessCodeEvents: AdministrationLegacyActorRecordCounts,
});
export type AdministrationLegacyAdministratorBackfillResult =
  typeof AdministrationLegacyAdministratorBackfillResult.Type;

export const AdminCliAdministratorsApi = HttpApiGroup.make("administrators")
  .add(
    HttpApiEndpoint.post(
      "backfillLegacyAdministrator",
      "/administrators/legacy-backfill",
      {
        payload: AdministrationLegacyAdministratorBackfillInput,
        success: AdministrationLegacyAdministratorBackfillResult,
        error: [CliResourceNotFound.schema, CliServiceUnavailable.schema],
      }
    )
  )
  .middleware(CliBearerAuthentication)
  .prefix("/api/v1/cli");
