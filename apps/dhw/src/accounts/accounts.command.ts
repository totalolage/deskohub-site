import type { AdministrationAccountBackfillReportType } from "@deskohub/workspace-admin-api";
import { Console, Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { CliApiRequestError } from "../api/workspace-admin-api-client.service";
import {
  confirmationFlag,
  confirmChange,
  reportCancellation,
  runAuthenticatedCommand,
} from "../command-runtime";

/** Sum work across batches; keep initial state from the first and current state from the last. */
export const combineAccountBackfillReports = (
  reports: readonly [
    AdministrationAccountBackfillReportType,
    ...AdministrationAccountBackfillReportType[],
  ]
): AdministrationAccountBackfillReportType => {
  const [first, ...later] = reports;
  const last = later.at(-1) ?? first;
  const sum = (
    select: (report: AdministrationAccountBackfillReportType) => number
  ) => reports.reduce((total, report) => total + select(report), 0);

  return {
    dryRun: first.dryRun,
    logins: {
      created: sum((report) => report.logins.created),
      alreadyPresent: first.logins.alreadyPresent,
    },
    links: {
      recorded: sum((report) => report.links.recorded),
      alreadyRecorded: first.links.alreadyRecorded,
      conflicts: last.links.conflicts,
    },
    tombstones: {
      recorded: sum((report) => report.tombstones.recorded),
      alreadyDeleted: first.tombstones.alreadyDeleted,
      skippedRecent: last.tombstones.skippedRecent,
    },
    authors: {
      alreadyAuthored: first.authors.alreadyAuthored,
      viaLink: {
        customers: sum((report) => report.authors.viaLink.customers),
        reservations: sum((report) => report.authors.viaLink.reservations),
      },
      viaNewLogin: {
        customers: sum((report) => report.authors.viaNewLogin.customers),
        reservations: sum((report) => report.authors.viaNewLogin.reservations),
      },
      viaResumedLogin: {
        customers: sum((report) => report.authors.viaResumedLogin.customers),
        reservations: sum(
          (report) => report.authors.viaResumedLogin.reservations
        ),
      },
      refused: last.authors.refused,
      remainingCustomers: last.authors.remainingCustomers,
    },
  };
};

const accountsBackfillCommand = Command.make(
  "backfill",
  {
    dryRun: Flag.boolean("dry-run").pipe(
      Flag.withDescription("Report what would change without writing")
    ),
    yes: confirmationFlag,
  },
  ({ dryRun, yes }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        if (!dryRun) {
          const confirmed = yield* confirmChange(
            yes,
            json,
            "Create missing customer accounts, record Dotypos links on them, mark accounts whose login is gone as deleted, and give authorless reservations an author, creating unverified logins without sending email?"
          );
          if (!confirmed) {
            yield* reportCancellation(json);
            return;
          }
        }

        const first = yield* api.backfillAccounts(accessToken, { dryRun });
        const reports: [
          AdministrationAccountBackfillReportType,
          ...AdministrationAccountBackfillReportType[],
        ] = [first];
        let previousRemaining = first.authors.remainingCustomers;

        while (!dryRun && previousRemaining > 0) {
          const report = yield* api.backfillAccounts(accessToken, { dryRun });
          if (report.authors.remainingCustomers >= previousRemaining) {
            return yield* new CliApiRequestError({
              message: "The account backfill made no progress.",
            });
          }
          reports.push(report);
          previousRemaining = report.authors.remainingCustomers;
        }

        const result = combineAccountBackfillReports(reports);
        if (json) {
          yield* Console.log(JSON.stringify(result));
          return;
        }

        yield* Console.log(
          `Logins: ${dryRun ? "would create" : "created"} ${result.logins.created}, already present ${result.logins.alreadyPresent}`
        );
        yield* Console.log(
          `Dotypos links: ${dryRun ? "would record" : "recorded"} ${result.links.recorded}, already recorded ${result.links.alreadyRecorded}, conflicts ${result.links.conflicts}`
        );
        yield* Console.log(
          `Accounts without a login: ${dryRun ? "would mark deleted" : "marked deleted"} ${result.tombstones.recorded}, already deleted ${result.tombstones.alreadyDeleted}, skipped recent ${result.tombstones.skippedRecent}`
        );
        yield* Console.log(
          `Authors: already authored ${result.authors.alreadyAuthored} reservations`
        );
        yield* Console.log(
          `  via existing link: ${result.authors.viaLink.customers} customers, ${result.authors.viaLink.reservations} reservations`
        );
        yield* Console.log(
          `  via new unverified login: ${result.authors.viaNewLogin.customers} customers, ${result.authors.viaNewLogin.reservations} reservations`
        );
        yield* Console.log(
          `  via resumed unverified login: ${result.authors.viaResumedLogin.customers} customers, ${result.authors.viaResumedLogin.reservations} reservations`
        );
        yield* Console.log(
          `Refused: ${result.authors.refused.length} customers`
        );
        for (const refusal of result.authors.refused) {
          yield* Console.log(
            `${refusal.dotyposCustomerId}\t${refusal.reason}\t${refusal.reservations}`
          );
        }
      })
    )
).pipe(
  Command.withDescription(
    "Create missing customer accounts and give legacy reservations an author, creating unverified logins silently where needed"
  )
);

export const accountsCommand = Command.make("accounts").pipe(
  Command.withDescription("Manage Workspace customer accounts"),
  Command.withSubcommands([accountsBackfillCommand])
);
