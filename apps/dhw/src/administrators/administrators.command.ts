import {
  AdministrationAccountEmail,
  type AdministrationLegacyActorRecordCountsType,
  AdministrationLegacyUsername,
} from "@deskohub/workspace-admin-api";
import { Console, Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import {
  confirmationFlag,
  confirmChange,
  reportCancellation,
  runAuthenticatedCommand,
} from "../command-runtime";

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
  Command.withSubcommands([administratorsBackfillLegacyCommand])
);
