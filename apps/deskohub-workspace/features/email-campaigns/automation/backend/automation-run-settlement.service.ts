import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { Array as Arr, Context, Effect, Layer, Match, Option } from "effect";
import {
  emailCampaignAutomationRuns,
  emailCampaignRecipients,
} from "@/db/schema";
import type { DatabaseQueryError } from "@/db/sql-constraint";
import type { CampaignSendId } from "../../campaign-identifiers";
import type {
  CampaignRecipientSkipReason,
  CampaignRecipientStatus,
} from "../../campaign-states";
import type { AutomationRunId } from "../automation-identifiers";
import {
  type AutomationRunEnding,
  AutomationRunTransitions,
} from "./automation-run-transitions";
import type { AutomationEngineTransaction } from "./automation-unit-handler";

export interface IAutomationRunSettlement {
  /**
   * Ends the `sending` runs an automated send carried, from their
   * recipients' settled statuses, in the transaction that settles the send:
   * an accepted email ends `sent`, `unconfirmed` stays `unconfirmed`,
   * `skipped` ends with the recipient's skip reason and `failed` ends
   * `failed / delivery-refused`. A run whose recipient is still `pending`
   * stays `sending` and is logged.
   */
  readonly settle: (
    tx: AutomationEngineTransaction,
    send: { readonly sendId: CampaignSendId; readonly at: Temporal.Instant }
  ) => Effect.Effect<void, DatabaseQueryError>;
}

/** Settles the automation runs behind a delivered automated send. */
export class AutomationRunSettlement extends Context.Service<
  AutomationRunSettlement,
  IAutomationRunSettlement
>()("@deskohub-workspace/email-campaigns/AutomationRunSettlement") {
  static Default = Layer.succeed(this, {
    settle: Effect.fn("AutomationRunSettlement.settle")(function* (
      tx: AutomationEngineTransaction,
      send: { readonly sendId: CampaignSendId; readonly at: Temporal.Instant }
    ) {
      yield* sendingRuns(tx, send.sendId).pipe(
        Effect.map(settlementOf),
        Effect.tap(({ endings }) =>
          Effect.forEach(endings, ({ ending, runIds }) =>
            AutomationRunTransitions.end(tx, {
              ...ending,
              runIds,
              expect: { status: "sending" },
              at: send.at,
            })
          )
        ),
        Effect.tap(({ unsettled }) =>
          Effect.logWarning(
            "Automated send settled with runs left sending"
          ).pipe(
            Effect.annotateLogs({ sendId: send.sendId, runs: unsettled }),
            Effect.when(Effect.succeed(unsettled > 0))
          )
        )
      );
    }),
  });
}

type SendingRun = {
  readonly runId: AutomationRunId;
  readonly recipientStatus: CampaignRecipientStatus;
  readonly skipReason: CampaignRecipientSkipReason | null;
};

/** The send's `sending` runs with their recipients, in id order. */
const sendingRuns = (tx: AutomationEngineTransaction, sendId: CampaignSendId) =>
  tx
    .select({
      runId: emailCampaignAutomationRuns.id,
      recipientStatus: emailCampaignRecipients.status,
      skipReason: emailCampaignRecipients.skipReason,
    })
    .from(emailCampaignAutomationRuns)
    .innerJoin(
      emailCampaignRecipients,
      and(
        eq(emailCampaignRecipients.sendId, emailCampaignAutomationRuns.sendId),
        eq(
          emailCampaignRecipients.dotyposCustomerId,
          emailCampaignAutomationRuns.dotyposCustomerId
        )
      )
    )
    .where(
      and(
        eq(emailCampaignAutomationRuns.sendId, sendId),
        eq(emailCampaignAutomationRuns.status, "sending")
      )
    )
    .orderBy(asc(emailCampaignAutomationRuns.id));

/**
 * Groups the runs by the ending their recipient settles them with, keeping
 * id order within each group, and counts the runs left unsettled.
 */
const settlementOf = (runs: readonly SendingRun[]) => {
  const ended = runs.flatMap((run) =>
    Option.match(recipientEnding(run), {
      onNone: () => [],
      onSome: (ending) => [{ ending, runId: run.runId }],
    })
  );
  const endings = Object.values(
    Arr.groupBy(ended, ({ ending }) =>
      "reason" in ending ? `${ending.outcome}:${ending.reason}` : ending.outcome
    )
  ).map((group) => ({
    ending: group[0].ending,
    runIds: group.map(({ runId }) => runId),
  }));
  return { endings, unsettled: runs.length - ended.length };
};

/**
 * How a recipient's settled status ends its run; none while `pending`, or
 * for a `skipped` recipient without a reason, which the recipient CHECK
 * rules out.
 */
const recipientEnding = (run: SendingRun): Option.Option<AutomationRunEnding> =>
  Match.value(run.recipientStatus).pipe(
    Match.when(Match.is("sent", "delivered", "complained", "bounced"), () =>
      Option.some<AutomationRunEnding>({ outcome: "sent" })
    ),
    Match.when("unconfirmed", () =>
      Option.some<AutomationRunEnding>({ outcome: "unconfirmed" })
    ),
    Match.when("skipped", () =>
      Option.map(
        Option.fromNullishOr(run.skipReason),
        (reason): AutomationRunEnding => ({ outcome: "skipped", reason })
      )
    ),
    Match.when("failed", () =>
      Option.some<AutomationRunEnding>({
        outcome: "failed",
        reason: "delivery-refused",
      })
    ),
    Match.when("pending", () => Option.none()),
    Match.exhaustive
  );
