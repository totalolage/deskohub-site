import { randomUUID } from "node:crypto";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect } from "effect";
import {
  type ActionResponseOutcome,
  awaitActionQuiescence,
} from "../admin-case";

/**
 * One run's synthetic recipient-preview fixture. The tag is unique to the
 * run, so the audience matches exactly the one tagged synthetic customer
 * however many consenting customers the preview database already holds.
 */
export interface EmailCampaignPreviewPlan {
  readonly audienceTitle: string;
  readonly body: string;
  readonly campaignTitle: string;
  readonly customerFirstName: string;
  readonly customerTag: string;
  readonly recipientEmail: string;
  readonly subject: string;
}

export const planEmailCampaignPreview = (
  key: string = randomUUID().replaceAll("-", "").slice(0, 16)
): EmailCampaignPreviewPlan => ({
  audienceTitle: `Workspace E2E audience ${key}`,
  body: `Synthetic Workspace E2E campaign body ${key}.`,
  campaignTitle: `Workspace E2E campaign ${key}`,
  customerFirstName: "Workspace E2E campaign",
  customerTag: `e2e-campaign-${key}`,
  recipientEmail: testEmailAddress(`delivered+campaign-${key}`),
  subject: `Workspace E2E ${key}`,
});

/**
 * Closes the browser context first, so no Server Action request can leave the
 * browser after this point. It then waits for the audience save and the
 * campaign draft creation to settle, and deletes the run's exact-match rows
 * whatever those barriers report. A submission the browser never sent settles
 * as undispatched once the context closes; a sent one settles through its
 * response or converges on its persisted row. A failed close or barrier still
 * fails cleanup, but only after the deletes have run.
 */
export const releaseEmailCampaignFixture = <E, R>(input: {
  readonly barrierTimeoutMs: number;
  readonly closeBrowser: Effect.Effect<void, E, R>;
  readonly audienceSubmission: Promise<ActionResponseOutcome> | undefined;
  readonly campaignSubmission: Promise<ActionResponseOutcome> | undefined;
  readonly audiencePersisted: Effect.Effect<boolean, E, R>;
  readonly campaignPersisted: Effect.Effect<boolean, E, R>;
  readonly deleteRows: Effect.Effect<void, E, R>;
}) =>
  input.closeBrowser.pipe(
    Effect.ensuring(
      Effect.orDie(
        awaitActionQuiescence({
          barrierTimeoutMs: input.barrierTimeoutMs,
          label: "save audience action",
          responseSettled: input.audienceSubmission,
          waitForTerminalEvent: input.audiencePersisted,
        })
      )
    ),
    Effect.ensuring(
      Effect.orDie(
        awaitActionQuiescence({
          barrierTimeoutMs: input.barrierTimeoutMs,
          label: "create campaign draft action",
          responseSettled: input.campaignSubmission,
          waitForTerminalEvent: input.campaignPersisted,
        })
      )
    ),
    Effect.ensuring(Effect.orDie(input.deleteRows))
  );
