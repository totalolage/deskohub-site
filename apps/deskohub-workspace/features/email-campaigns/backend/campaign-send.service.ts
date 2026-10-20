import "server-only";

import { EmailServiceTag } from "@deskohub/email";
import { NodeCrypto } from "@effect/platform-node";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import {
  Array as Arr,
  type Config,
  Context,
  Effect,
  Layer,
  Match,
  Option,
  type PlatformError,
  Schema,
} from "effect";
import type { SqlError } from "effect/unstable/sql";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type CampaignAudienceRow,
  type CampaignRow,
  emailCampaignRecipients,
  emailCampaignSends,
  emailCampaigns,
} from "@/db/schema";
import { type Locale, locales } from "@/features/i18n";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { EmailConfigLayer } from "@/shared/backend/config/email.config";
import {
  getWorkspaceRuntimeCallbackOrigin,
  type WorkspaceUrlConfigError,
} from "@/shared/backend/config/workspace-url.config";
import { currentInstant } from "@/shared/utils/temporal";
import type { AudienceFilter } from "../audience-filter";
import { hashCampaignContent } from "../body/campaign-content-hash";
import {
  CampaignEmailFooter,
  renderCampaignEmail,
} from "../body/render-campaign-email";
import {
  campaignTestMessage,
  type RenderedCampaignEmail,
} from "../campaign-email-message";
import type {
  CampaignAudienceId,
  CampaignConfirmationCode,
  CampaignId,
  CampaignSendId,
} from "../campaign-identifiers";
import { isOnceCampaign } from "../campaign-states";
import {
  CampaignAudienceMissing,
  type CampaignAudienceNotFound,
  type CampaignConfirmationRejected,
  CampaignContentMissing,
  CampaignDeliveryMismatch,
  CampaignDeliveryQueueFailed,
  CampaignEmailDeliveryFailed,
  type CampaignEmailNotConfigured,
  CampaignFallbackContentMissing,
  CampaignNoRecipients,
  CampaignNotFound,
  CampaignNotRetryable,
  CampaignReadOnly,
  type CampaignRecipientResolutionError,
  type CampaignRecipientsOutsideTestDomain,
  type CampaignSigningKeyInvalid,
  CampaignTestRecipientInvalid,
} from "../errors";
import { ensureCampaignRecipientsAllowed } from "../recipient-domain-guard";
import { campaignContentCoversAudience } from "../recipient-locale";
import { AudienceFactsService } from "./audience-facts.service";
import { CampaignService } from "./campaign.service";
import { CampaignAudienceService } from "./campaign-audience.service";
import { CampaignCandidateRepository } from "./campaign-candidate.repository";
import {
  CampaignConfirmationCodeService,
  type CampaignSendFreeze,
} from "./campaign-confirmation-code.service";
import { CampaignEmailConfig } from "./campaign-email.config";
import { CampaignRecipientService } from "./campaign-recipient.service";
import { CampaignSendQueueService } from "./campaign-send-queue.service";
import { onceCampaignSend } from "./campaign-send-selection";

type DatabaseError = EffectDrizzleQueryError | SqlError.SqlError;

type CampaignTestSend = {
  /** The admin inbox first, then the typed addresses. */
  readonly recipients: readonly string[];
  /** The locales with content; every recipient got one email per locale. */
  readonly locales: readonly Locale[];
  readonly codeExpiresAt: Temporal.Instant;
};

type CampaignSendStarted = {
  readonly sendId: CampaignSendId;
  readonly recipientCount: number;
};

type CampaignRetryStarted = {
  readonly sendId: CampaignSendId;
  readonly retriedCount: number;
};

/**
 * Campaign email or signing configuration a sending operation can't run
 * without. The live service builds its capabilities per operation, so only
 * sending operations report it.
 */
export type CampaignSendingSetupError =
  | CampaignEmailNotConfigured
  | CampaignSigningKeyInvalid
  | Config.ConfigError
  | Schema.SchemaError;

export interface ICampaignSendService {
  /**
   * Mails every recipient (the admin inbox first) one `[TEST]` email per
   * locale with content. Each carries a new confirmation code bound to the
   * current content, which supersedes earlier codes. Test emails aren't
   * campaign deliveries. Content must cover the campaign's current
   * audience, as for the real send.
   */
  readonly testSend: (input: {
    readonly campaignId: CampaignId;
    readonly extraRecipients: readonly string[];
  }) => Effect.Effect<
    CampaignTestSend,
    | CampaignNotFound
    | CampaignDeliveryMismatch
    | CampaignReadOnly
    | CampaignTestRecipientInvalid
    | CampaignRecipientsOutsideTestDomain
    | CampaignContentMissing
    | CampaignFallbackContentMissing
    | CampaignEmailDeliveryFailed
    | WorkspaceUrlConfigError
    | PlatformError.PlatformError
    | DatabaseError
    | CampaignSendingSetupError
  >;
  /**
   * Checks the content covers the current audience and resolves it, then
   * confirms the code and freezes the recipients with the audience snapshot
   * in one transaction, and queues the delivery. A coverage, resolution, or
   * guard failure leaves the code and the Draft untouched.
   */
  readonly send: (input: {
    readonly campaignId: CampaignId;
    readonly confirmationCode: string;
  }) => Effect.Effect<
    CampaignSendStarted,
    | CampaignNotFound
    | CampaignDeliveryMismatch
    | CampaignReadOnly
    | CampaignConfirmationRejected
    | CampaignAudienceMissing
    | CampaignAudienceNotFound
    | CampaignFallbackContentMissing
    | CampaignRecipientResolutionError
    | CampaignRecipientsOutsideTestDomain
    | CampaignNoRecipients
    | CampaignDeliveryQueueFailed
    | DatabaseError
    | CampaignSendingSetupError
  >;
  /**
   * Queues a new delivery attempt for a Failed campaign's recipients that
   * are still pending or failed. `unconfirmed` recipients may already have
   * the email, so they're mailed again only with `includeUnconfirmed`.
   * Sent, delivered, bounced, complained, and skipped recipients never are.
   */
  readonly retryUndelivered: (input: {
    readonly campaignId: CampaignId;
    readonly includeUnconfirmed?: boolean;
  }) => Effect.Effect<
    CampaignRetryStarted,
    | CampaignNotFound
    | CampaignDeliveryMismatch
    | CampaignNotRetryable
    | CampaignDeliveryQueueFailed
    | DatabaseError
    | CampaignSendingSetupError
  >;
}

/** Test sends, the confirmed real send, and retries of a failed send. */
export class CampaignSendService extends Context.Service<
  CampaignSendService,
  ICampaignSendService
>()("@deskohub-workspace/email-campaigns/CampaignSendService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const campaigns = yield* CampaignService;
      const audiences = yield* CampaignAudienceService;
      const recipientResolution = yield* CampaignRecipientService;
      const confirmation = yield* CampaignConfirmationCodeService;
      const config = yield* CampaignEmailConfig;
      const email = yield* EmailServiceTag;
      const queue = yield* CampaignSendQueueService;

      const getDraft = (campaignId: CampaignId) =>
        campaigns.getOnce(campaignId).pipe(
          Effect.flatMap((campaign) =>
            Match.value(campaign.status).pipe(
              Match.when("draft", () => Effect.succeed(campaign)),
              Match.orElse((status) =>
                Effect.fail(new CampaignReadOnly({ campaignId, status }))
              )
            )
          )
        );

      /** The admin inbox first, then each typed address once. */
      const testRecipients = (extraRecipients: readonly string[]) =>
        Effect.forEach(extraRecipients, (address) =>
          Schema.decodeUnknownEffect(reservationCustomerEmailSchema)(
            address
          ).pipe(
            Effect.mapError(
              () => new CampaignTestRecipientInvalid({ email: address })
            )
          )
        ).pipe(
          Effect.map((typed) =>
            Arr.dedupeWith(
              [config.adminInbox, ...typed],
              (a, b) => a.toLowerCase() === b.toLowerCase()
            )
          )
        );

      const ensureRecipientsAllowed = (emails: readonly string[]) =>
        ensureCampaignRecipientsAllowed({
          deploymentEnvironment: config.deploymentEnvironment,
          emails,
        });

      /** The locales the campaign has content for, in locale order. */
      const requireContentLocales = (campaign: CampaignRow) =>
        Effect.succeed(
          locales.filter((locale) => campaign.content[locale] !== undefined)
        ).pipe(
          Effect.filterOrFail(
            (contentLocales) => contentLocales.length > 0,
            () => new CampaignContentMissing({ campaignId: campaign.id })
          )
        );

      /**
       * The filter of the campaign's current audience. A campaign without
       * one, or whose audience is gone, counts as unrestricted.
       */
      const currentAudienceFilter = (campaign: CampaignRow) =>
        Option.fromNullishOr(campaign.audienceId).pipe(
          Option.map((audienceId) =>
            audiences
              .get(audienceId)
              .pipe(Effect.map((audience) => audience.filter))
          ),
          Effect.transposeOption,
          Effect.catchTag("CampaignAudienceNotFound", () => Effect.succeedNone)
        );

      const ensureContentCoversAudience = (input: {
        readonly campaign: CampaignRow;
        readonly audienceFilter: Option.Option<AudienceFilter>;
      }) =>
        Effect.succeed(input).pipe(
          Effect.filterOrFail(
            ({ campaign, audienceFilter }) =>
              campaignContentCoversAudience({
                content: campaign.content,
                audienceFilter,
              }),
            ({ campaign }) =>
              new CampaignFallbackContentMissing({ campaignId: campaign.id })
          ),
          Effect.asVoid
        );

      const issueTestCode = (campaign: CampaignRow) =>
        confirmation
          .issue({
            campaignId: campaign.id,
            contentHash: hashCampaignContent({
              purpose: campaign.purpose,
              templateKey: campaign.templateKey,
              locales: campaign.content,
            }),
          })
          .pipe(
            // Preview inboxes are Console-only, so the code is read here.
            Effect.tap((issued) =>
              Effect.logInfo("Campaign test send confirmation code", {
                campaignId: campaign.id,
                confirmationCode: issued.code,
              }).pipe(
                Effect.when(
                  Effect.succeed(config.deploymentEnvironment !== "production")
                )
              )
            )
          );

      /** One `[TEST]` email per content locale, each with the new code. */
      const renderTestEmails = (input: {
        readonly campaign: CampaignRow;
        readonly contentLocales: readonly Locale[];
        readonly issued: { readonly code: CampaignConfirmationCode };
      }) =>
        getWorkspaceRuntimeCallbackOrigin.pipe(
          Effect.map((origin) => new URL("/account/legal", origin).href),
          Effect.flatMap((preferencesPreviewUrl) =>
            Effect.forEach(input.contentLocales, (locale) =>
              renderCampaignEmail({
                templateKey: input.campaign.templateKey,
                locale,
                content: input.campaign.content[locale]!,
                footer:
                  input.campaign.purpose === "marketing"
                    ? CampaignEmailFooter.Marketing({
                        marketingPreferencesUrl: preferencesPreviewUrl,
                      })
                    : CampaignEmailFooter.Operational(),
                confirmationCode: input.issued.code,
              })
            ).pipe(
              Effect.mapError(
                (cause) => new CampaignEmailDeliveryFailed({ cause })
              )
            )
          )
        );

      const mailTestEmails = (input: {
        readonly recipients: readonly string[];
        readonly emails: readonly RenderedCampaignEmail[];
      }) =>
        Effect.forEach(input.recipients, (to) =>
          Effect.forEach(input.emails, (rendered) =>
            email.send(
              campaignTestMessage({
                sender: config,
                to,
                email: rendered,
                deploymentEnvironment: config.deploymentEnvironment,
              })
            )
          )
        ).pipe(
          Effect.mapError((cause) => new CampaignEmailDeliveryFailed({ cause }))
        );

      const assignedAudience = (campaign: CampaignRow) =>
        Effect.succeed(campaign.audienceId).pipe(
          Effect.filterOrFail(
            (audienceId): audienceId is CampaignAudienceId =>
              audienceId !== null,
            () => new CampaignAudienceMissing({ campaignId: campaign.id })
          ),
          Effect.flatMap(audiences.get)
        );

      /** The audience's reachable recipients, guarded outside production. */
      const resolveSendRecipients = (input: {
        readonly campaign: CampaignRow;
        readonly audience: CampaignAudienceRow;
      }) =>
        recipientResolution
          .resolve({
            purpose: input.campaign.purpose,
            filter: input.audience.filter,
          })
          .pipe(
            Effect.map(({ recipients }) => recipients),
            Effect.filterOrFail(
              (recipients) => recipients.length > 0,
              () => new CampaignNoRecipients({ campaignId: input.campaign.id })
            ),
            Effect.tap((recipients) =>
              ensureRecipientsAllowed(
                recipients.map((recipient) => recipient.email)
              )
            )
          );

      /** Consumes the code and freezes the recipients with the audience. */
      const confirmSend = (input: {
        readonly campaign: CampaignRow;
        readonly audience: CampaignAudienceRow;
        readonly recipients: readonly CampaignSendFreeze["recipients"][number][];
        readonly confirmationCode: string;
      }) =>
        confirmation
          .confirm({
            campaignId: input.campaign.id,
            code: input.confirmationCode,
            send: {
              audienceId: input.audience.id,
              audienceFilter: input.audience.filter,
              recipients: input.recipients.map(
                ({ dotyposCustomerId, locale }) => ({
                  dotyposCustomerId,
                  locale,
                })
              ),
            },
          })
          .pipe(Effect.map(({ sendId }) => sendId));

      /** Hands an attempt to the queue; a failure leaves the campaign Failed. */
      const enqueueOrFail = Effect.fn("CampaignSendService.enqueueOrFail")(
        function* (input: {
          readonly campaignId: CampaignId;
          readonly sendId: CampaignSendId;
          readonly deliveryAttempt: number;
        }) {
          yield* queue
            .enqueue({
              sendId: input.sendId,
              deliveryAttempt: input.deliveryAttempt,
            })
            .pipe(
              Effect.catchTag("CampaignSendQueueError", (cause) =>
                currentInstant.pipe(
                  Effect.flatMap((updatedAt) =>
                    db
                      .update(emailCampaigns)
                      .set({ status: "failed", updatedAt })
                      .where(
                        and(
                          eq(emailCampaigns.id, input.campaignId),
                          eq(emailCampaigns.status, "sending")
                        )
                      )
                  ),
                  Effect.andThen(
                    Effect.fail(
                      new CampaignDeliveryQueueFailed({
                        campaignId: input.campaignId,
                        cause,
                      })
                    )
                  )
                )
              )
            );
        }
      );

      type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

      /**
       * Under the campaign row lock, moves a Failed campaign back to Sending
       * and puts its undelivered recipients into a new delivery attempt.
       */
      const startRetry = Effect.fn("CampaignSendService.startRetry")(function* (
        tx: Transaction,
        input: {
          readonly campaignId: CampaignId;
          readonly includeUnconfirmed: boolean;
          readonly now: Temporal.Instant;
        }
      ) {
        const { campaignId, now } = input;
        const [campaign] = yield* tx
          .select({
            delivery: emailCampaigns.delivery,
            status: emailCampaigns.status,
          })
          .from(emailCampaigns)
          .where(eq(emailCampaigns.id, campaignId))
          .for("update");
        if (!campaign) {
          return yield* new CampaignNotFound({ campaignId });
        }
        if (!isOnceCampaign(campaign)) {
          return yield* new CampaignDeliveryMismatch({
            campaignId,
            delivery: campaign.delivery,
          });
        }
        if (campaign.status !== "failed") {
          return yield* new CampaignNotRetryable({
            campaignId,
            status: campaign.status,
          });
        }
        const [send] = yield* tx
          .update(emailCampaignSends)
          .set({
            deliveryAttempt: sql`${emailCampaignSends.deliveryAttempt} + 1`,
          })
          .where(onceCampaignSend(campaignId))
          .returning({
            sendId: emailCampaignSends.id,
            deliveryAttempt: emailCampaignSends.deliveryAttempt,
          });
        const retried = yield* tx
          .update(emailCampaignRecipients)
          .set({
            deliveryAttempt: send!.deliveryAttempt,
            status: "pending",
            statusUpdatedAt: now,
          })
          .where(
            and(
              eq(emailCampaignRecipients.sendId, send!.sendId),
              inArray(
                emailCampaignRecipients.status,
                input.includeUnconfirmed
                  ? ["pending", "failed", "unconfirmed"]
                  : ["pending", "failed"]
              )
            )
          )
          .returning({
            dotyposCustomerId: emailCampaignRecipients.dotyposCustomerId,
          });
        yield* tx
          .update(emailCampaigns)
          .set({ status: "sending", updatedAt: now })
          .where(eq(emailCampaigns.id, campaignId));
        return { ...send!, retriedCount: retried.length };
      });

      return {
        testSend: Effect.fn("CampaignSendService.testSend")((input) =>
          Effect.succeed(input).pipe(
            Effect.bind("campaign", ({ campaignId }) => getDraft(campaignId)),
            Effect.bind("recipients", ({ extraRecipients }) =>
              testRecipients(extraRecipients)
            ),
            Effect.tap(({ recipients }) => ensureRecipientsAllowed(recipients)),
            Effect.bind("contentLocales", ({ campaign }) =>
              requireContentLocales(campaign)
            ),
            Effect.bind("audienceFilter", ({ campaign }) =>
              currentAudienceFilter(campaign)
            ),
            Effect.tap(ensureContentCoversAudience),
            Effect.bind("issued", ({ campaign }) => issueTestCode(campaign)),
            Effect.bind("emails", renderTestEmails),
            Effect.tap(mailTestEmails),
            Effect.map(
              ({ recipients, contentLocales, issued }): CampaignTestSend => ({
                recipients,
                locales: contentLocales,
                codeExpiresAt: issued.expiresAt,
              })
            )
          )
        ),

        send: Effect.fn("CampaignSendService.send")((input) =>
          Effect.succeed(input).pipe(
            Effect.bind("campaign", ({ campaignId }) => getDraft(campaignId)),
            Effect.bind("audience", ({ campaign }) =>
              assignedAudience(campaign)
            ),
            Effect.tap(({ campaign, audience }) =>
              ensureContentCoversAudience({
                campaign,
                audienceFilter: Option.some(audience.filter),
              })
            ),
            Effect.bind("recipients", resolveSendRecipients),
            Effect.bind("sendId", confirmSend),
            Effect.tap(({ campaignId, sendId }) =>
              enqueueOrFail({ campaignId, sendId, deliveryAttempt: 1 })
            ),
            Effect.map(
              ({ sendId, recipients }): CampaignSendStarted => ({
                sendId,
                recipientCount: recipients.length,
              })
            )
          )
        ),

        retryUndelivered: Effect.fn("CampaignSendService.retryUndelivered")(
          ({ campaignId, includeUnconfirmed = false }) =>
            currentInstant.pipe(
              Effect.flatMap((now) =>
                db.transaction((tx) =>
                  startRetry(tx, { campaignId, includeUnconfirmed, now })
                )
              ),
              Effect.tap(({ sendId, deliveryAttempt }) =>
                enqueueOrFail({ campaignId, sendId, deliveryAttempt })
              ),
              Effect.map(
                ({ sendId, retriedCount }): CampaignRetryStarted => ({
                  sendId,
                  retriedCount,
                })
              )
            )
        ),
      } satisfies ICampaignSendService;
    })
  );

  /**
   * Builds `layer` when an operation runs instead of with the runtime that
   * provides this service, so a setup failure fails only that operation,
   * with its typed {@link CampaignSendingSetupError}. Layers the runtime
   * already built, such as the database, are reused through its memo map.
   */
  static perOperation = (
    layer: Layer.Layer<CampaignSendService, CampaignSendingSetupError>
  ) => Layer.sync(CampaignSendService, () => provideOnEachOperation(layer));

  /**
   * Builds the sending capabilities per operation, so a deployment without
   * campaign email or signing configuration fails only the sending
   * operations, and every endpoint and page sharing the runtime keeps
   * working.
   */
  static Live = this.perOperation(
    this.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          CampaignService.Default,
          CampaignAudienceService.Default,
          CampaignRecipientService.Default.pipe(
            Layer.provide(AudienceFactsService.Default),
            Layer.provide(
              Layer.mergeAll(
                CampaignCandidateRepository.Default,
                WorkspaceDotyposLayer
              )
            )
          ),
          CampaignConfirmationCodeService.Default.pipe(
            Layer.provide(NodeCrypto.layer)
          ),
          CampaignEmailConfig.Default,
          CampaignSendQueueService.Default,
          EmailServiceTag.RecipientRouted.pipe(Layer.provide(EmailConfigLayer))
        )
      ),
      Layer.provide(WorkspaceDatabase.Default)
    )
  );
}

/** Runs each operation against a service built from `layer` for it. */
const provideOnEachOperation = (
  layer: Layer.Layer<CampaignSendService, CampaignSendingSetupError>
): ICampaignSendService => ({
  testSend: (input) =>
    CampaignSendService.pipe(
      Effect.flatMap((sending) => sending.testSend(input)),
      Effect.provide(layer)
    ),
  send: (input) =>
    CampaignSendService.pipe(
      Effect.flatMap((sending) => sending.send(input)),
      Effect.provide(layer)
    ),
  retryUndelivered: (input) =>
    CampaignSendService.pipe(
      Effect.flatMap((sending) => sending.retryUndelivered(input)),
      Effect.provide(layer)
    ),
});
