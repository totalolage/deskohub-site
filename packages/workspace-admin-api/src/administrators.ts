import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import {
  AdministrationOperationBehavior,
  destructiveOperation,
  dryRunPreview,
  readOperation,
  readPreview,
} from "./administration-operation";
import {
  AdministrationAccountId,
  AdministrationActionRecord,
  AdministrationAuthentication,
  AdministrationLegacyUsername,
  CliMutationRejected,
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

/** An account that holds the administrator role. */
export const AdministrationAdministrator = Schema.Struct({
  accountId: AdministrationAccountId,
  /** The account's login email. */
  email: Schema.String,
  /** Null when a bootstrap granted the role or the granter was deleted. */
  grantedByEmail: Schema.NullOr(Schema.String),
  /** ISO instant. */
  grantedAt: Schema.String,
});
export type AdministrationAdministrator =
  typeof AdministrationAdministrator.Type;

export const AdministrationAdministratorList = Schema.Struct({
  /** Oldest grant first. */
  administrators: Schema.Array(AdministrationAdministrator),
});
export type AdministrationAdministratorList =
  typeof AdministrationAdministratorList.Type;

export const AdministrationAdministratorGrantInput = Schema.Struct({
  email: AdministrationAccountEmail,
}).annotate({
  parseOptions: { errors: "all", onExcessProperty: "error" },
});
export type AdministrationAdministratorGrantInput =
  typeof AdministrationAdministratorGrantInput.Type;

export const AdministrationAdministratorGrantResult = Schema.Struct({
  outcome: Schema.Literals(["granted", "already_granted"]),
  /** The login email of the account that holds the role. */
  email: Schema.String,
});
export type AdministrationAdministratorGrantResult =
  typeof AdministrationAdministratorGrantResult.Type;

export const AdministrationAdministratorRevocationResult = Schema.Struct({
  outcome: Schema.Literals(["revoked", "not_administrator"]),
});
export type AdministrationAdministratorRevocationResult =
  typeof AdministrationAdministratorRevocationResult.Type;

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

const administratorsPreview = readPreview("administrators.listAdministrators");

export const AdminCliAdministratorsApi = HttpApiGroup.make("administrators")
  .add(
    HttpApiEndpoint.get("listAdministrators", "/administrators", {
      success: AdministrationAdministratorList,
    }).annotate(AdministrationOperationBehavior, readOperation)
  )
  .add(
    HttpApiEndpoint.post("grantAdministrator", "/administrators", {
      payload: AdministrationAdministratorGrantInput,
      success: AdministrationAdministratorGrantResult,
      error: [
        CliMutationRejected.schema,
        CliResourceNotFound.schema,
        CliServiceUnavailable.schema,
      ],
    }).annotate(
      AdministrationOperationBehavior,
      destructiveOperation({ idempotent: true, preview: administratorsPreview })
    )
  )
  .add(
    HttpApiEndpoint.delete(
      "revokeAdministrator",
      "/administrators/:accountId",
      {
        params: { accountId: AdministrationAccountId },
        success: AdministrationAdministratorRevocationResult,
        error: [CliMutationRejected.schema, CliServiceUnavailable.schema],
      }
    ).annotate(
      AdministrationOperationBehavior,
      destructiveOperation({ idempotent: true, preview: administratorsPreview })
    )
  )
  .add(
    HttpApiEndpoint.post(
      "backfillLegacyAdministrator",
      "/administrators/legacy-backfill",
      {
        payload: AdministrationLegacyAdministratorBackfillInput,
        success: AdministrationLegacyAdministratorBackfillResult,
        error: [CliResourceNotFound.schema, CliServiceUnavailable.schema],
      }
    ).annotate(
      AdministrationOperationBehavior,
      destructiveOperation({ idempotent: true, preview: dryRunPreview })
    )
  )
  .middleware(AdministrationActionRecord)
  .middleware(AdministrationAuthentication)
  .prefix("/api/v1/cli");
