import {
  AdministrationAccountEmail,
  AdministrationAccountId,
  type AdministrationAccountIdType,
  type AdministrationAdministratorType,
  type AdministrationLegacyActorRecordCountsType,
  AdministrationLegacyUsername,
} from "@deskohub/workspace-admin-api";
import { Console, Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import {
  confirmationFlag,
  confirmChange,
  reportCancellation,
  runAuthenticatedCommand,
} from "../command-runtime";

const administratorsListCommand = Command.make("list", {}, () =>
  runAuthenticatedCommand((api, accessToken, json) =>
    Effect.gen(function* () {
      const result = yield* api.listAdministrators(accessToken);
      if (json) {
        yield* Console.log(JSON.stringify(result));
        return;
      }
      yield* Console.log(`Administrators: ${result.administrators.length}`);
      for (const administrator of result.administrators) {
        yield* Console.log(
          [
            administrator.accountId,
            administrator.email,
            administrator.grantedAt,
            administrator.grantedByEmail ?? "Granted by the system",
          ].join("\t")
        );
      }
    })
  )
).pipe(
  Command.withDescription("List the accounts that hold the administrator role")
);

const administratorsGrantCommand = Command.make(
  "grant",
  {
    email: Flag.string("email").pipe(
      Flag.withSchema(AdministrationAccountEmail),
      Flag.withDescription(
        "Login email of the account to make an administrator"
      )
    ),
    yes: confirmationFlag,
  },
  ({ email, yes }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const confirmed = yield* confirmChange(
          "administrators.grantAdministrator",
          yes,
          json,
          `Grant the administrator role to ${email}? The account gets full access to the administration.`
        );
        if (!confirmed) {
          yield* reportCancellation(json);
          return;
        }

        const result = yield* api.grantAdministrator(accessToken, { email });
        yield* Console.log(
          json
            ? JSON.stringify(result)
            : {
                granted: `Granted the administrator role to ${result.email}.`,
                already_granted: `${result.email} is already an administrator.`,
              }[result.outcome]
        );
      })
    )
).pipe(
  Command.withDescription(
    "Grant the administrator role to the active account that signs in with an email"
  )
);

/**
 * Names the account for the revocation prompt: its email when it's a listed
 * administrator, otherwise its id alone.
 */
export const describeRevocationTarget = (
  accountId: AdministrationAccountIdType,
  administrators: ReadonlyArray<AdministrationAdministratorType>
) => {
  const administrator = administrators.find(
    (candidate) => candidate.accountId === accountId
  );
  return administrator
    ? `${administrator.email} (account ${accountId})`
    : `account ${accountId}`;
};

const administratorsRevokeCommand = Command.make(
  "revoke",
  {
    accountId: Argument.string("account-id").pipe(
      Argument.withSchema(AdministrationAccountId),
      Argument.withDescription(
        "Account id, as dhw administrators list shows it"
      )
    ),
    yes: confirmationFlag,
  },
  ({ accountId, yes }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        if (!yes) {
          const { administrators } = yield* api.listAdministrators(accessToken);
          const confirmed = yield* confirmChange(
            "administrators.revokeAdministrator",
            yes,
            json,
            `Revoke the administrator role from ${describeRevocationTarget(accountId, administrators)}? Its access stops on its next request.`
          );
          if (!confirmed) {
            yield* reportCancellation(json);
            return;
          }
        }

        const result = yield* api.revokeAdministrator(accessToken, accountId);
        yield* Console.log(
          json
            ? JSON.stringify(result)
            : {
                revoked: `Revoked the administrator role from account ${accountId}.`,
                not_administrator: `Account ${accountId} isn't an administrator.`,
              }[result.outcome]
        );
      })
    )
).pipe(Command.withDescription("Revoke another account's administrator role"));

const formatRecordCounts = (
  label: string,
  counts: AdministrationLegacyActorRecordCountsType,
  dryRun: boolean
) =>
  `${label}: ${dryRun ? "would link" : "linked"} ${counts.linked}, already linked ${counts.alreadyLinked}, linked to another account ${counts.linkedToOtherAccount}`;

const administratorsBackfillLegacyCommand = Command.make(
  "backfill-legacy",
  {
    legacyUsername: Flag.string("legacy-username").pipe(
      Flag.withSchema(AdministrationLegacyUsername),
      Flag.withDescription("Legacy Basic-auth administrator username")
    ),
    email: Flag.string("email").pipe(
      Flag.withSchema(AdministrationAccountEmail),
      Flag.withDescription("Login email of the target Workspace account")
    ),
    dryRun: Flag.boolean("dry-run").pipe(
      Flag.withDescription("Report what would change without writing")
    ),
    yes: confirmationFlag,
  },
  ({ legacyUsername, email, dryRun, yes }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        if (!dryRun) {
          const confirmed = yield* confirmChange(
            "administrators.backfillLegacyAdministrator",
            yes,
            json,
            `Grant the administrator role to ${email} and link legacy administrator ${legacyUsername}'s records to that account?`
          );
          if (!confirmed) {
            yield* reportCancellation(json);
            return;
          }
        }

        const result = yield* api.backfillLegacyAdministrator(accessToken, {
          legacyUsername,
          email,
          dryRun,
        });
        if (json) {
          yield* Console.log(JSON.stringify(result));
          return;
        }

        yield* Console.log(
          `Administrator role: ${
            {
              already_granted: "already granted",
              granted: result.dryRun ? "would grant" : "granted",
            }[result.administratorRole]
          }`
        );
        yield* Console.log(
          formatRecordCounts("CLI sessions", result.cliSessions, result.dryRun)
        );
        yield* Console.log(
          formatRecordCounts(
            "Manual invoices",
            result.manualInvoices,
            result.dryRun
          )
        );
        yield* Console.log(
          formatRecordCounts(
            "Standalone access-code events",
            result.standaloneAccessCodeEvents,
            result.dryRun
          )
        );
      })
    )
).pipe(
  Command.withDescription(
    "Grant the administrator role to an account and link a legacy Basic-auth administrator's records to it"
  )
);

export const administratorsCommand = Command.make("administrators").pipe(
  Command.withDescription("Manage Workspace administrators"),
  Command.withSubcommands([
    administratorsListCommand,
    administratorsGrantCommand,
    administratorsRevokeCommand,
    administratorsBackfillLegacyCommand,
  ])
);
