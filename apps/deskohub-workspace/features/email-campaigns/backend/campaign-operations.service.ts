import "server-only";

import {
  type CampaignOperationError,
  type CampaignOperationName,
  type CampaignOperations as CampaignOperationRegistry,
  type CampaignTemplatePreviewInputType,
  campaignOperations,
  OperationConflict,
  type OperationDecodedInput,
  type OperationInput,
  OperationInputInvalid,
  type OperationOutput,
  OperationUnauthorized,
} from "@deskohub/workspace-admin-api";
import { Context, Effect, Layer, Match, Schema, SchemaIssue } from "effect";
import { AccountRoleGrants } from "@/features/administrators/backend/account-role-grants.service";
import { CurrentAdministrator } from "@/features/administrators/backend/current-administrator";
import { getRuntimeMarketingPreferencesAccessUrl } from "@/features/legal/marketing-preferences-access-url";
import { type AudienceFilter, audienceFilterSchema } from "../audience-filter";
import type { CampaignPurpose } from "../body/campaign-content";
import { campaignTemplates } from "../body/campaign-templates";
import {
  CampaignEmailFooter,
  renderCampaignEmail,
} from "../body/render-campaign-email";
import { CampaignService } from "./campaign.service";
import { CampaignAudienceService } from "./campaign-audience.service";
import {
  type CampaignOperationCause,
  toOperationError,
} from "./campaign-operation-errors";
import {
  toAdministrationAudience,
  toAdministrationCampaignDetail,
  toAdministrationCampaignSummary,
  toAdministrationSendStatus,
  toCampaignLocaleContent,
  toCampaignLocalizedContent,
} from "./campaign-operation-projections";
import { CampaignRecipientService } from "./campaign-recipient.service";
import { CampaignSendService } from "./campaign-send.service";
import { CampaignSendStatusService } from "./campaign-send-status.service";
import { OperationRequestLedger } from "./operation-request-ledger.service";

type Registry = CampaignOperationRegistry;

/** One handler per registered operation; a missing one fails the typecheck. */
type CampaignOperationHandlers = {
  readonly [Name in CampaignOperationName]: (
    input: OperationDecodedInput<Registry[Name]>
  ) => Effect.Effect<OperationOutput<Registry[Name]>, CampaignOperationCause>;
};

export interface ICampaignOperations {
  /**
   * Runs one campaign operation for the current administrator: re-checks
   * the administrator grant, decodes the input strictly, applies a ledger
   * operation once through the adapter's ledger, runs the handler, and maps
   * its failure to a port error. Every adapter gets the same behaviour.
   */
  readonly invoke: <Name extends CampaignOperationName>(
    name: Name,
    input: OperationInput<Registry[Name]>
  ) => Effect.Effect<
    OperationOutput<Registry[Name]>,
    CampaignOperationError,
    CurrentAdministrator | OperationRequestLedger
  >;
}

/** The single port the admin UI, `/api/v1/cli` and future adapters call. */
export class CampaignOperations extends Context.Service<
  CampaignOperations,
  ICampaignOperations
>()("@deskohub-workspace/email-campaigns/CampaignOperations") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const grants = yield* AccountRoleGrants;
      const handlers = yield* makeCampaignOperationHandlers;

      const authorize = CurrentAdministrator.pipe(
        Effect.flatMap(({ accountId }) =>
          grants.has({ accountId, role: "administrator" })
        ),
        Effect.mapError(toOperationError),
        Effect.filterOrFail(
          (isAdministrator) => isAdministrator,
          () =>
            new OperationUnauthorized({
              code: "administrator-required",
              message:
                "Your account isn't an administrator any more. Ask an administrator to grant the role again.",
            })
        )
      );

      const invoke = <Name extends CampaignOperationName>(
        name: Name,
        input: OperationInput<Registry[Name]>
      ) => {
        const operation: Registry[Name] = campaignOperations[name];
        const handle: CampaignOperationHandlers[Name] = handlers[name];
        return authorize.pipe(
          Effect.andThen(decodeOperationInput(operation.input, input)),
          Effect.flatMap((decoded) =>
            operation.ledger
              ? OperationRequestLedger.pipe(
                  Effect.flatMap(
                    (ledger) =>
                      // The registry pairs a ledger operation's name with its
                      // input, which a generic name can't express.
                      ledger.applyOnce({
                        operation: name,
                        input: decoded,
                        apply: handle(decoded),
                      } as never) as Effect.Effect<
                        OperationOutput<Registry[Name]>,
                        CampaignOperationCause
                      >
                  )
                )
              : handle(decoded)
          ),
          Effect.mapError(toOperationError),
          Effect.withSpan("CampaignOperations.invoke", {
            attributes: { operation: name },
          })
        ) as Effect.Effect<
          OperationOutput<Registry[Name]>,
          CampaignOperationError,
          CurrentAdministrator | OperationRequestLedger
        >;
      };

      return { invoke } satisfies ICampaignOperations;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        AccountRoleGrants.Live,
        CampaignAudienceService.Live,
        CampaignService.Live,
        CampaignRecipientService.Live,
        CampaignSendService.Live,
        CampaignSendStatusService.Live
      )
    )
  );
}

const strictParseOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const;

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();

/** Unknown keys and invalid values fail as one `input-invalid` error. */
const decodeOperationInput = <S extends Schema.Decoder<unknown>>(
  schema: S,
  input: S["Encoded"]
): Effect.Effect<S["Type"], OperationInputInvalid> =>
  Schema.decodeUnknownEffect(schema)(input, strictParseOptions).pipe(
    Effect.mapError(
      (cause) =>
        new OperationInputInvalid({
          code: "input-invalid",
          message: `The input is invalid: ${cause.message}`,
          issues: formatIssues(cause.issue).issues.map(({ path, message }) => ({
            path: (path ?? []).map((segment) => String(segment)),
            message,
          })),
          cause,
        })
    )
  );

/** The contract mirrors the domain filter; its own schema has the last word. */
const decodeAudienceFilter = (filter: AudienceFilter) =>
  Schema.decodeUnknownEffect(audienceFilterSchema)(filter).pipe(
    Effect.mapError(
      (cause) =>
        new OperationInputInvalid({
          code: "audience-filter-invalid",
          message: `The audience filter is invalid: ${cause.message}`,
          cause,
        })
    )
  );

/** The preview footer: the real link carries each recipient's token. */
const previewFooter = (purpose: CampaignPurpose) =>
  Match.value(purpose).pipe(
    Match.when("marketing", () =>
      getRuntimeMarketingPreferencesAccessUrl("preview").pipe(
        Effect.map((marketingPreferencesUrl) =>
          CampaignEmailFooter.Marketing({ marketingPreferencesUrl })
        )
      )
    ),
    Match.when("operational", () =>
      Effect.succeed(CampaignEmailFooter.Operational())
    ),
    Match.exhaustive
  );

const makeCampaignOperationHandlers = Effect.gen(function* () {
  const audiences = yield* CampaignAudienceService;
  const campaigns = yield* CampaignService;
  const recipients = yield* CampaignRecipientService;
  const sending = yield* CampaignSendService;
  const sendStatus = yield* CampaignSendStatusService;

  /** Unsaved texts, or a saved campaign's locale. */
  const loadPreviewSource = (
    preview: CampaignTemplatePreviewInputType["preview"]
  ) =>
    Match.value(preview).pipe(
      Match.tagsExhaustive({
        Content: ({ purpose, locale, content }) =>
          toCampaignLocaleContent(locale, content).pipe(
            Effect.map((parsed) => ({ purpose, content: parsed }))
          ),
        Campaign: ({ campaignId, locale }) =>
          campaigns.get(campaignId).pipe(
            Effect.flatMap((campaign) => {
              const content = campaign.content[locale];
              return content === undefined
                ? Effect.fail(
                    new OperationInputInvalid({
                      code: "content-locale-missing",
                      message: `The campaign has no ${locale} content.`,
                    })
                  )
                : Effect.succeed({ purpose: campaign.purpose, content });
            })
          ),
      })
    );

  /** Who the campaign's audience reaches now, as the real send would. */
  const previewCampaignRecipients = Effect.fn(
    "CampaignOperations.previewCampaignRecipients"
  )(function* (campaignId: Parameters<typeof campaigns.get>[0]) {
    const campaign = yield* campaigns.get(campaignId);
    if (campaign.audienceId === null) {
      return yield* new OperationConflict({
        code: "audience-missing",
        message: "The campaign has no audience. Set one first.",
      });
    }
    const audience = yield* audiences.get(campaign.audienceId);
    const resolution = yield* recipients.resolve({
      purpose: campaign.purpose,
      filter: audience.filter,
    });
    return {
      recipients: resolution.recipients.map(
        ({ dotyposCustomerId, locale, email }) => ({
          customerId: dotyposCustomerId,
          locale,
          email,
        })
      ),
      exclusions: resolution.exclusions.map(
        ({ dotyposCustomerId, reason }) => ({
          customerId: dotyposCustomerId,
          reason,
        })
      ),
      duplicates: resolution.duplicates,
    };
  });

  const handlers: CampaignOperationHandlers = {
    listCampaignAudiences: () =>
      audiences
        .list({ includeArchived: true })
        .pipe(Effect.map((rows) => rows.map(toAdministrationAudience))),
    getCampaignAudience: ({ audienceId }) =>
      audiences.get(audienceId).pipe(Effect.map(toAdministrationAudience)),
    createCampaignAudience: ({ audience }) =>
      decodeAudienceFilter(audience.filter).pipe(
        Effect.flatMap((filter) =>
          audiences.create({ title: audience.title, filter })
        ),
        Effect.map(toAdministrationAudience)
      ),
    updateCampaignAudience: ({ filter, ...update }) =>
      (filter === undefined
        ? audiences.update(update)
        : decodeAudienceFilter(filter).pipe(
            Effect.flatMap((decoded) =>
              audiences.update({ ...update, filter: decoded })
            )
          )
      ).pipe(Effect.map(toAdministrationAudience)),
    archiveCampaignAudience: ({ audienceId }) =>
      audiences.archive(audienceId).pipe(Effect.map(toAdministrationAudience)),
    unarchiveCampaignAudience: ({ audienceId }) =>
      audiences
        .unarchive(audienceId)
        .pipe(Effect.map(toAdministrationAudience)),
    deleteCampaignAudience: ({ audienceId }) =>
      audiences.delete(audienceId).pipe(Effect.as({ id: audienceId })),
    listCampaignTemplates: () =>
      Effect.succeed(
        Object.values(campaignTemplates).map(({ key, name, description }) => ({
          key,
          name,
          description,
        }))
      ),
    previewCampaignTemplate: ({ templateKey, preview }) =>
      loadPreviewSource(preview).pipe(
        Effect.flatMap(({ purpose, content }) =>
          previewFooter(purpose).pipe(
            Effect.flatMap((footer) =>
              renderCampaignEmail({
                templateKey,
                locale: preview.locale,
                content,
                footer,
              })
            )
          )
        ),
        Effect.map(({ subject, html, text }) => ({ subject, html, text }))
      ),
    listCampaigns: () =>
      campaigns.list.pipe(
        Effect.map((rows) => rows.map(toAdministrationCampaignSummary))
      ),
    getCampaign: ({ campaignId }) =>
      campaigns
        .get(campaignId)
        .pipe(Effect.map(toAdministrationCampaignDetail)),
    createCampaign: ({ campaign }) =>
      toCampaignLocalizedContent(campaign.content).pipe(
        Effect.flatMap((content) =>
          campaigns.create({
            title: campaign.title,
            purpose: campaign.purpose,
            templateKey: campaign.templateKey,
            audienceId: campaign.audienceId,
            delivery: campaign.delivery ?? "once",
            content,
          })
        ),
        Effect.map(toAdministrationCampaignDetail)
      ),
    updateCampaign: (input) =>
      campaigns.patch(input).pipe(Effect.map(toAdministrationCampaignDetail)),
    duplicateCampaign: ({ campaignId }) =>
      campaigns
        .duplicate(campaignId)
        .pipe(Effect.map(toAdministrationCampaignDetail)),
    deleteCampaign: ({ campaignId }) =>
      campaigns.delete(campaignId).pipe(Effect.as({ id: campaignId })),
    previewCampaignRecipients: ({ campaignId }) =>
      previewCampaignRecipients(campaignId),
    testSendCampaign: ({ campaignId, recipients: extraRecipients }) =>
      sending.testSend({ campaignId, extraRecipients }).pipe(
        Effect.map((result) => ({
          recipients: result.recipients,
          locales: result.locales,
          codeExpiresAt: result.codeExpiresAt.toString(),
        }))
      ),
    sendCampaign: (input) => sending.send(input),
    retryCampaign: (input) => sending.retryUndelivered(input),
    getCampaignSendStatus: ({ campaignId }) =>
      sendStatus
        .get({ campaignId })
        .pipe(Effect.map(toAdministrationSendStatus)),
  };

  return handlers;
});
