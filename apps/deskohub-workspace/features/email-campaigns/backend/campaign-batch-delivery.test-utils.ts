import type { DotyposCustomer, DotyposCustomerId } from "@deskohub/dotypos";
import { DotyposServiceMock } from "@deskohub/dotypos/backend/service.mock";
import { makeInMemoryDotypos } from "@deskohub/dotypos/testing";
import {
  EmailConfigTag,
  type EmailMessage,
  EmailServiceTag,
} from "@deskohub/email";
import { makeEmailProviderFake } from "@deskohub/email/testing";
import { testEmailAddress } from "@deskohub/test-email";
import { eq } from "drizzle-orm";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  emailCampaignAutomationVersions,
  emailCampaignSends,
  emailCampaigns,
} from "@/db/schema";
import type { WorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import type { CampaignPurpose } from "../body/campaign-content";
import type { CampaignId, CampaignSendId } from "../campaign-identifiers";
import {
  type BatchOutcome,
  type BatchRecipient,
  BatchRequest,
  CampaignBatchDelivery,
  CampaignDeliveryIncomplete,
  type DeliveredAttempt,
  type PersistedBatch,
  PreparedBatch,
} from "./campaign-batch-delivery.service";
import { campaignDeliveryTestLayer } from "./campaign-delivery.test-utils";
import { CampaignEmailConfig } from "./campaign-email.config";
import {
  seedAutomatedCampaign,
  seedAutomatedSend,
  seedAutomationVersion,
  seedCampaignSend,
} from "./email-campaigns.test-utils";

/** The send kinds whose drivers call the batch protocol. */
export const batchSendKinds = ["one-off", "automated"] as const;
export type BatchSendKind = (typeof batchSendKinds)[number];

/** A batch persisted the way its kind's driver persists it. */
export type PersistedTestBatch = {
  readonly kind: BatchSendKind;
  readonly send: DeliveredAttempt;
  readonly batch: PersistedBatch;
  /** The messages its persist rendered, which a one-off run requests. */
  readonly messages: readonly EmailMessage[];
  /** The profiles it was persisted from, which a deliver unit requests from. */
  readonly profiles: ReadonlyMap<DotyposCustomerId, DotyposCustomer>;
};

/**
 * The campaign batch protocol over a Dotypos stand-in whose profiles the
 * test sets and an email provider fake, on `database`. Each operation runs
 * as one of its drivers calls it and resolves to its exit.
 */
export const makeBatchDeliveryHarness = (
  database: WorkspacePostgresTestDatabase
) => {
  const provider = makeEmailProviderFake();
  let profiles: readonly DotyposCustomer[] = [];
  const layer = campaignDeliveryTestLayer(
    Layer.mergeAll(
      DotyposServiceMock({
        getCustomersByIds: (ids) =>
          makeInMemoryDotypos({
            customers: [...profiles],
          }).service.getCustomersByIds(ids),
      }),
      EmailServiceTag.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            provider.layer,
            Layer.succeed(EmailConfigTag, {
              defaultFrom: { email: testEmailAddress("campaigns") },
            })
          )
        )
      ),
      Layer.succeed(CampaignEmailConfig, {
        deploymentEnvironment: "development",
        from: { email: testEmailAddress("campaigns") },
        replyTo: { email: testEmailAddress("hello") },
        adminInbox: testEmailAddress("admin"),
      })
    )
  ).pipe(Layer.provideMerge(database.layer));

  const run = <A, E>(
    effect: Effect.Effect<A, E, CampaignBatchDelivery | WorkspaceDatabase>
  ) => Effect.runPromiseExit(effect.pipe(Effect.provide(layer)));

  const runOrThrow = async <A, E>(
    effect: Effect.Effect<A, E, CampaignBatchDelivery | WorkspaceDatabase>
  ) => {
    const exit = await run(effect);
    if (Exit.isFailure(exit)) throw exit.cause;
    return exit.value;
  };

  /** The campaign email a send mails, as its driver reads it. */
  const deliveredAttempt = async (
    kind: BatchSendKind,
    sendId: CampaignSendId
  ): Promise<DeliveredAttempt> => {
    const { db } = database;
    const [campaign] = await Effect.runPromise(
      kind === "one-off"
        ? db
            .select({
              id: emailCampaigns.id,
              purpose: emailCampaigns.purpose,
              templateKey: emailCampaigns.templateKey,
              content: emailCampaigns.content,
            })
            .from(emailCampaignSends)
            .innerJoin(
              emailCampaigns,
              eq(emailCampaigns.id, emailCampaignSends.campaignId)
            )
            .where(eq(emailCampaignSends.id, sendId))
        : db
            .select({
              id: emailCampaignSends.campaignId,
              purpose: emailCampaignAutomationVersions.purpose,
              templateKey: emailCampaignAutomationVersions.templateKey,
              content: emailCampaignAutomationVersions.content,
            })
            .from(emailCampaignSends)
            .innerJoin(
              emailCampaignAutomationVersions,
              eq(
                emailCampaignAutomationVersions.id,
                emailCampaignSends.automationVersionId
              )
            )
            .where(eq(emailCampaignSends.id, sendId))
    );
    return { sendId, deliveryAttempt: 1, campaign: campaign! };
  };

  /**
   * A frozen send of `kind` to `recipients`, whose profiles become the
   * Dotypos stand-in's. Returns the campaign to clean up.
   */
  const seedSend = async (input: {
    readonly kind: BatchSendKind;
    readonly purpose: CampaignPurpose;
    readonly recipients: readonly DotyposCustomer[];
  }) => {
    profiles = input.recipients;
    const recipients = input.recipients.map((profile) => ({
      dotyposCustomerId: profile.id!,
    }));
    const { db } = database;
    if (input.kind === "one-off") {
      const { campaignId, sendId } = await seedCampaignSend(db, {
        purpose: input.purpose,
        recipients,
      });
      return {
        campaignId: campaignId as CampaignId,
        send: await deliveredAttempt(input.kind, sendId),
      };
    }
    const campaignId = await seedAutomatedCampaign(db, {
      purpose: input.purpose,
    });
    const versionId = await seedAutomationVersion(db, {
      campaignId,
      purpose: input.purpose,
    });
    const sendId = await seedAutomatedSend(db, {
      campaignId,
      versionId,
      purpose: input.purpose,
      recipients,
    });
    return {
      campaignId,
      send: await deliveredAttempt(input.kind, sendId),
    };
  };

  /**
   * Prepares and persists every recipient of `send` as one batch, the way
   * the kind's driver does: a one-off run re-reads the profiles outside any
   * transaction and persists in its own, a deliver unit prepares and
   * persists in one transaction from the profiles it read.
   */
  const persist = (input: {
    readonly kind: BatchSendKind;
    readonly send: DeliveredAttempt;
    readonly recipients: readonly BatchRecipient[];
    /** Runs first in the persist's transaction. */
    readonly before?: Effect.Effect<void, unknown, WorkspaceDatabase>;
  }): Promise<PersistedTestBatch> => {
    const read = new Map(profiles.map((profile) => [profile.id!, profile]));
    const persistPrepared = (prepared: PreparedBatch) =>
      Effect.flatMap(CampaignBatchDelivery, (batches) =>
        batches.persist({ prepared, at: Temporal.Now.instant() })
      ).pipe(
        Effect.map((batch) => ({
          kind: input.kind,
          send: input.send,
          batch: Option.getOrThrow(batch),
          messages: PreparedBatch.$match(prepared, {
            Rendered: ({ messages }) => messages,
            Unrendered: () => [],
          }),
          profiles: read,
        }))
      );
    const prepare = (profilesRead: Option.Option<typeof read>) =>
      Effect.flatMap(CampaignBatchDelivery, (batches) =>
        batches.prepare({
          send: input.send,
          recipients: input.recipients,
          profiles: profilesRead,
        })
      );
    const before = input.before ?? Effect.void;
    return runOrThrow(
      Effect.flatMap(WorkspaceDatabase, ({ transaction }) =>
        input.kind === "one-off"
          ? prepare(Option.none()).pipe(
              Effect.flatMap((prepared) =>
                transaction(
                  before.pipe(Effect.andThen(persistPrepared(prepared)))
                )
              )
            )
          : transaction(
              before.pipe(
                Effect.andThen(prepare(Option.some(read))),
                Effect.flatMap(persistPrepared)
              )
            )
      )
    );
  };

  /** Requests a batch; resolves to the outcome or the request's failure. */
  const request = (batchRequest: BatchRequest) =>
    run(
      Effect.flatMap(CampaignBatchDelivery, (batches) =>
        batches.request(batchRequest)
      )
    );

  /**
   * The batch's first request as its kind's driver makes it: a one-off run
   * with the messages it rendered, a deliver unit from the profiles it read.
   */
  const requestFirst = (persisted: PersistedTestBatch) =>
    request(
      persisted.kind === "one-off"
        ? BatchRequest.First({
            batch: persisted.batch,
            messages: persisted.messages,
          })
        : BatchRequest.Reproduced({
            send: persisted.send,
            batch: persisted.batch,
            profiles: persisted.profiles,
          })
    );

  /**
   * Replays a batch whose outcome is unknown. Unless `admitted`, the
   * caller stops it once it is known to be within its replay window, as a
   * one-off run past its start budget does.
   */
  const replay = (
    persisted: PersistedTestBatch,
    options: { readonly admitted: boolean } = { admitted: true }
  ) =>
    request(
      BatchRequest.Replay({
        send: persisted.send,
        batch: persisted.batch,
        admit: options.admitted
          ? Effect.void
          : Effect.fail(
              new CampaignDeliveryIncomplete({
                sendId: persisted.send.sendId,
                deliveryAttempt: persisted.send.deliveryAttempt,
              })
            ),
      })
    );

  /** The attempt's batches whose outcome is unknown. */
  const listRequested = (send: DeliveredAttempt) =>
    runOrThrow(
      Effect.flatMap(CampaignBatchDelivery, (batches) =>
        batches.listRequested(send)
      )
    );

  /** Settles a batch's outcome in a transaction of its own. */
  const settle = (batch: PersistedBatch, outcome: BatchOutcome) =>
    runOrThrow(
      Effect.flatMap(WorkspaceDatabase, ({ transaction }) =>
        transaction(
          Effect.flatMap(CampaignBatchDelivery, (batches) =>
            batches.settle({ batch, outcome, at: Temporal.Now.instant() })
          )
        )
      )
    );

  return {
    provider,
    setProfiles: (next: readonly DotyposCustomer[]) => {
      profiles = next;
    },
    seedSend,
    persist,
    requestFirst,
    replay,
    request,
    listRequested,
    settle,
  };
};

/** The tag of the failure an operation's exit ended with, if any. */
export const failureTagOf = <A, E>(exit: Exit.Exit<A, E>) =>
  Exit.isFailure(exit)
    ? (Cause.squash(exit.cause) as { readonly _tag?: string })._tag
    : undefined;

/** The outcome an operation's exit succeeded with; throws on a failure. */
export const outcomeOf = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
  return exit.value;
};
