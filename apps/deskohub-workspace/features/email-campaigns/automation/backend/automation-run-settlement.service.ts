import "server-only";

import { and, count, eq } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import type { WorkspaceDatabaseClient } from "@/db/database.service";
import { emailCampaignAutomationRuns } from "@/db/schema";
import type { CampaignSendId } from "../../campaign-identifiers";

type Transaction = Parameters<
  Parameters<WorkspaceDatabaseClient["transaction"]>[0]
>[0];

export interface IAutomationRunSettlement {
  /**
   * Ends the `sending` runs an automated send carried, from their
   * recipients' settled statuses, in the transaction that settles the send.
   * Runs end only through the run transitions; until those exist no run
   * reaches `sending`, so this ends nothing and only reports a run it finds.
   */
  readonly settle: (
    tx: Transaction,
    send: { readonly sendId: CampaignSendId }
  ) => Effect.Effect<void, EffectDrizzleQueryError>;
}

/** Settles the automation runs behind a delivered automated send. */
export class AutomationRunSettlement extends Context.Service<
  AutomationRunSettlement,
  IAutomationRunSettlement
>()("@deskohub-workspace/email-campaigns/AutomationRunSettlement") {
  static Default = Layer.succeed(this, {
    settle: Effect.fn("AutomationRunSettlement.settle")(function* (
      tx: Transaction,
      { sendId }: { readonly sendId: CampaignSendId }
    ) {
      const [sending] = yield* tx
        .select({ runs: count() })
        .from(emailCampaignAutomationRuns)
        .where(
          and(
            eq(emailCampaignAutomationRuns.sendId, sendId),
            eq(emailCampaignAutomationRuns.status, "sending")
          )
        );
      if (sending && sending.runs > 0) {
        yield* Effect.logWarning(
          "Automated send settled with runs left sending"
        ).pipe(Effect.annotateLogs({ sendId, runs: sending.runs }));
      }
    }),
  });
}
