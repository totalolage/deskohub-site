import {
  AdministrationCampaignAudience,
  type AdministrationCampaignAudienceType,
  type AdministrationCampaignContentType,
  AdministrationCampaignDetail,
  type AdministrationCampaignDetailType,
  type AdministrationCampaignLocaleContentChangeType,
  type AdministrationCampaignLocaleContentType,
  type AdministrationCampaignSummaryType,
  type AdministrationCampaignTemplatePreviewInputType,
  type AdministrationCampaignUpdateInputType,
  CliInputInvalid,
  CliMutationRejected,
  CliResourceNotFound,
  CliServiceUnavailable,
  CurrentCliSession,
  WorkspaceAdminApi,
} from "@deskohub/workspace-admin-api";
import { Effect, Layer, Match, Option, Schema } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import type {
  CampaignAudienceRow,
  CampaignRow,
  CliStoredMutationResult,
} from "@/db/schema";
import {
  type AudienceFilter,
  audienceFilterSchema,
} from "@/features/email-campaigns/audience-filter";
import { CampaignService } from "@/features/email-campaigns/backend/campaign.service";
import { CampaignAudienceService } from "@/features/email-campaigns/backend/campaign-audience.service";
import { CampaignRecipientService } from "@/features/email-campaigns/backend/campaign-recipient.service";
import { CampaignSendService } from "@/features/email-campaigns/backend/campaign-send.service";
import { CampaignSendStatusService } from "@/features/email-campaigns/backend/campaign-send-status.service";
import {
  campaignBodyToMarkdown,
  parseCampaignBodyMarkdown,
} from "@/features/email-campaigns/body/campaign-body-markdown";
import type {
  CampaignLocaleContent,
  CampaignLocalizedContent,
  CampaignPurpose,
} from "@/features/email-campaigns/body/campaign-content";
import { campaignTemplates } from "@/features/email-campaigns/body/campaign-templates";
import {
  CampaignEmailFooter,
  renderCampaignEmail,
} from "@/features/email-campaigns/body/render-campaign-email";
import type {
  AudienceFilterContextInvalid,
  CampaignAudienceArchived,
  CampaignAudienceInUse,
  CampaignAudienceMissing,
  CampaignAudienceNotFound,
  CampaignConfirmationRejected,
  CampaignContentInvalid,
  CampaignContentMissing,
  CampaignDeliveryQueueFailed,
  CampaignEmailDeliveryFailed,
  CampaignEmailNotConfigured,
  CampaignFallbackContentMissing,
  CampaignNoRecipients,
  CampaignNotFound,
  CampaignNotRetryable,
  CampaignReadOnly,
  CampaignRecipientResolutionError,
  CampaignRecipientsOutsideTestDomain,
  CampaignSigningKeyInvalid,
  CampaignTestRecipientInvalid,
} from "@/features/email-campaigns/errors";
import { type Locale, locales } from "@/features/i18n";
import { getRuntimeMarketingPreferencesAccessUrl } from "@/features/legal/marketing-preferences-access-url";
import {
  makeServiceUnavailable,
  mapAdministrationApiFailure,
} from "./administration-api-failure";
import {
  CliMutationIdempotency,
  type CliMutationRequest,
} from "./cli-mutation-idempotency.service";

/** Every failure a campaign endpoint maps to its public API error. */
type CampaignApiCause =
  | CliInputInvalid
  | CliMutationRejected
  | AudienceFilterContextInvalid
  | CampaignAudienceArchived
  | CampaignAudienceInUse
  | CampaignAudienceMissing
  | CampaignAudienceNotFound
  | CampaignConfirmationRejected
  | CampaignContentInvalid
  | CampaignContentMissing
  | CampaignDeliveryQueueFailed
  | CampaignEmailDeliveryFailed
  | CampaignEmailNotConfigured
  | CampaignFallbackContentMissing
  | CampaignNoRecipients
  | CampaignNotFound
  | CampaignNotRetryable
  | CampaignReadOnly
  | CampaignRecipientResolutionError
  | CampaignRecipientsOutsideTestDomain
  | CampaignSigningKeyInvalid
  | CampaignTestRecipientInvalid
  | { readonly _tag: string };

const confirmationRejectionMessages = {
  "unknown-code":
    "The confirmation code doesn't match the latest test send. Check it for typos.",
  superseded:
    "A newer test send replaced this confirmation code. Use the code from the latest test email.",
  expired: "The confirmation code expired. Run a new test send.",
  "content-changed":
    "The campaign changed after the test send. Run a new test send.",
  "too-many-attempts":
    "Too many wrong confirmation codes were entered. Run a new test send.",
} satisfies Record<CampaignConfirmationRejected["reason"], string>;

const toCampaignApiFailure = (cause: CampaignApiCause) =>
  Match.value(cause).pipe(
    Match.tag(
      "CliInputInvalid",
      "CliMutationInProgress",
      "CliMutationRejected",
      (failure) => failure
    ),
    Match.tag(
      "CampaignNotFound",
      () => new CliResourceNotFound({ message: "The campaign was not found." })
    ),
    Match.tag(
      "CampaignAudienceNotFound",
      () => new CliResourceNotFound({ message: "The audience was not found." })
    ),
    Match.tag(
      "CampaignContentInvalid",
      ({ cause }) =>
        new CliInputInvalid({
          message: `The campaign content is invalid: ${cause.message}`,
        })
    ),
    Match.tag(
      "CampaignTestRecipientInvalid",
      ({ email }) =>
        new CliInputInvalid({
          message: `The test recipient "${email}" isn't a valid email address.`,
        })
    ),
    Match.tag(
      "CampaignReadOnly",
      ({ status }) =>
        new CliMutationRejected({
          message: `The campaign is ${status}, so it can no longer be changed.`,
        })
    ),
    Match.tag(
      "CampaignAudienceInUse",
      ({ draftCampaignIds }) =>
        new CliMutationRejected({
          message: `Draft campaigns use this audience (${draftCampaignIds.join(", ")}). Archive it instead, or move those drafts to another audience.`,
        })
    ),
    Match.tag(
      "CampaignAudienceArchived",
      () =>
        new CliMutationRejected({
          message: "The audience is archived. Choose another audience.",
        })
    ),
    Match.tag(
      "AudienceFilterContextInvalid",
      ({ uses }) =>
        new CliInputInvalid({
          message: `The audience filter uses ${[
            ...uses.attributes.map((attribute) => `the ${attribute} attribute`),
            ...uses.periods.map((period) => `${period} periods`),
            ...uses.campaignSources.map(
              (source) => `${source} campaign sources`
            ),
          ].join(", ")}, which saved audiences and campaigns can't use yet.`,
        })
    ),
    Match.tag(
      "CampaignConfirmationRejected",
      ({ reason }) =>
        new CliMutationRejected({
          message: confirmationRejectionMessages[reason],
        })
    ),
    Match.tag(
      "CampaignRecipientsOutsideTestDomain",
      ({ recipientCount }) =>
        new CliMutationRejected({
          message: `Outside production, campaign mail may reach only the email test domain, and ${recipientCount} recipients are outside it.`,
        })
    ),
    Match.tag(
      "CampaignContentMissing",
      () =>
        new CliMutationRejected({
          message: "The campaign has no content in any locale.",
        })
    ),
    Match.tag(
      "CampaignFallbackContentMissing",
      () =>
        new CliMutationRejected({
          message:
            "Customers without content in their language get the Czech version, so add Czech (cs-CZ) content, or restrict the audience to one locale the campaign has content for. Nothing was sent.",
        })
    ),
    Match.tag(
      "CampaignAudienceMissing",
      () =>
        new CliMutationRejected({
          message: "The campaign has no audience. Set one first.",
        })
    ),
    Match.tag(
      "CampaignNoRecipients",
      () =>
        new CliMutationRejected({
          message: "The campaign's audience doesn't reach any recipient.",
        })
    ),
    Match.tag(
      "CampaignNotRetryable",
      ({ status }) =>
        new CliMutationRejected({
          message: `Only a failed campaign can be retried, and this one is ${status}.`,
        })
    ),
    Match.tag(
      "CampaignRecipientResolutionError",
      ({ source }) =>
        new CliServiceUnavailable({
          message: `Recipients couldn't be resolved because the ${source === "dotypos" ? "Dotypos API" : "database"} is unavailable. Try again shortly.`,
        })
    ),
    Match.tag(
      "CampaignEmailDeliveryFailed",
      () =>
        new CliServiceUnavailable({
          message: "The test email couldn't be sent. Try again shortly.",
        })
    ),
    Match.tag(
      "CampaignDeliveryQueueFailed",
      () =>
        new CliServiceUnavailable({
          message:
            "The send was confirmed, but its delivery couldn't be queued. The campaign is now failed; retry its undelivered recipients.",
        })
    ),
    Match.orElse(toCampaignSetupFailure)
  );

/** Campaign sending setup the deployment lacks, else a generic outage. */
const toCampaignSetupFailure = (cause: CampaignApiCause) =>
  Match.value(cause).pipe(
    Match.tag(
      "CampaignEmailNotConfigured",
      ({ variables }) =>
        new CliServiceUnavailable({
          message: `Campaign email isn't configured for this deployment, so it can't send campaign mail. Ask a developer to set ${variables.join(", ")}.`,
        })
    ),
    Match.tag(
      "CampaignSigningKeyInvalid",
      () =>
        new CliServiceUnavailable({
          message:
            "Confirmation codes can't be issued or checked because the signing secret is misconfigured. Ask a developer to check BETTER_AUTH_SECRETS.",
        })
    ),
    Match.orElse(makeServiceUnavailable)
  );

const mapCampaignFailure = mapAdministrationApiFailure(toCampaignApiFailure);

/**
 * Creations aren't idempotent, so they go through the CLI mutation ledger: a
 * retried request replays the first result instead of creating again. The
 * creation commits together with its ledger entry, so a failed one frees the
 * request for a retry.
 */
const applyCampaignMutationOnce = <
  A extends CliStoredMutationResult,
  E extends CampaignApiCause,
  R,
>(
  ledger: CliMutationIdempotency["Service"],
  request: Omit<CliMutationRequest, "sessionId">,
  result: Schema.Decoder<A>,
  apply: Effect.Effect<A, E, R>
) =>
  CurrentCliSession.pipe(
    Effect.flatMap((session) =>
      ledger.applyOnce({
        request: { ...request, sessionId: session.id },
        result,
        apply,
      })
    )
  );

/** The locales a per-locale record has a value for, in locale order. */
const localeEntries = <Value>(
  record: Partial<Record<Locale, Value>>
): ReadonlyArray<readonly [Locale, Value]> =>
  locales.flatMap((locale) => {
    const value = record[locale];
    return value === undefined ? [] : [[locale, value] as const];
  });

/** The contract mirrors the domain filter; its own schema has the last word. */
const decodeAudienceFilter = (filter: AudienceFilter) =>
  Schema.decodeUnknownEffect(audienceFilterSchema)(filter).pipe(
    Effect.mapError(
      (cause) =>
        new CliInputInvalid({
          message: `The audience filter is invalid: ${cause.message}`,
        })
    )
  );

const parseLocaleBody = (locale: Locale, markdown: string) =>
  parseCampaignBodyMarkdown(markdown).pipe(
    Effect.mapError(
      (cause) =>
        new CliInputInvalid({
          message: `The ${locale} body isn't valid campaign Markdown: ${cause.message}`,
        })
    )
  );

const withOperationalReason = (
  content: Omit<CampaignLocaleContent, "operationalReason">,
  operationalReason: string | undefined
): CampaignLocaleContent =>
  operationalReason === undefined ? content : { ...content, operationalReason };

const toLocaleContent = Effect.fn("CampaignsApi.toLocaleContent")(function* (
  locale: Locale,
  content: AdministrationCampaignLocaleContentType
) {
  const body = yield* parseLocaleBody(locale, content.bodyMarkdown);
  return withOperationalReason(
    { subject: content.subject, preheader: content.preheader, body },
    content.operationalReason
  );
});

const toLocalizedContent = (content: AdministrationCampaignContentType) =>
  Effect.forEach(localeEntries(content), ([locale, localeContent]) =>
    toLocaleContent(locale, localeContent).pipe(
      Effect.map((parsed) => [locale, parsed] as const)
    )
  ).pipe(
    Effect.map(
      (entries): CampaignLocalizedContent => Object.fromEntries(entries)
    )
  );

const applyLocaleChange = Effect.fn("CampaignsApi.applyLocaleChange")(
  function* (
    locale: Locale,
    current: CampaignLocaleContent | undefined,
    change: AdministrationCampaignLocaleContentChangeType
  ) {
    const body =
      change.bodyMarkdown === undefined
        ? current?.body
        : yield* parseLocaleBody(locale, change.bodyMarkdown);
    const subject = change.subject ?? current?.subject;
    if (body === undefined || subject === undefined) {
      return yield* new CliInputInvalid({
        message: `The campaign has no ${locale} content yet, so it needs a subject and a body.`,
      });
    }
    return withOperationalReason(
      {
        subject,
        preheader: change.preheader ?? current?.preheader ?? "",
        body,
      },
      change.operationalReason === undefined
        ? current?.operationalReason
        : (change.operationalReason ?? undefined)
    );
  }
);

const changeLocaleContent = (
  locale: Locale,
  current: CampaignLocaleContent | undefined,
  change: AdministrationCampaignLocaleContentChangeType | null | undefined
): Effect.Effect<CampaignLocaleContent | undefined, CliInputInvalid> => {
  if (change === undefined) return Effect.succeed(current);
  if (change === null) return Effect.succeed(undefined);
  return applyLocaleChange(locale, current, change);
};

/** Applies per-locale changes; a null change removes the locale. */
const changeLocalizedContent = (
  current: CampaignLocalizedContent,
  changes: NonNullable<AdministrationCampaignUpdateInputType["content"]>
) =>
  Effect.forEach(locales, (locale) =>
    changeLocaleContent(locale, current[locale], changes[locale]).pipe(
      Effect.map((content) => [locale, content] as const)
    )
  ).pipe(
    Effect.map(
      (changed): CampaignLocalizedContent =>
        Object.fromEntries(
          changed.flatMap(([locale, content]) =>
            content === undefined ? [] : [[locale, content] as const]
          )
        )
    )
  );

const campaignLocales = (content: CampaignLocalizedContent) =>
  localeEntries(content).map(([locale]) => locale);

const toCliAudience = (
  audience: CampaignAudienceRow
): AdministrationCampaignAudienceType => ({
  id: audience.id,
  title: audience.title,
  filter: audience.filter,
  archivedAt: audience.archivedAt?.toString() ?? null,
  createdAt: audience.createdAt.toString(),
  updatedAt: audience.updatedAt.toString(),
});

const toCliCampaignSummary = (
  campaign: CampaignRow
): AdministrationCampaignSummaryType => ({
  id: campaign.id,
  title: campaign.title,
  purpose: campaign.purpose,
  templateKey: campaign.templateKey,
  status: campaign.status,
  audienceId: campaign.audienceId,
  locales: campaignLocales(campaign.content),
  createdAt: campaign.createdAt.toString(),
  updatedAt: campaign.updatedAt.toString(),
});

const toCliLocaleContent = ({
  body,
  ...content
}: CampaignLocaleContent): AdministrationCampaignLocaleContentType => ({
  ...content,
  bodyMarkdown: campaignBodyToMarkdown(body),
});

const toCliCampaignDetail = (
  campaign: CampaignRow
): AdministrationCampaignDetailType => ({
  ...toCliCampaignSummary(campaign),
  content: Object.fromEntries(
    localeEntries(campaign.content).map(([locale, content]) => [
      locale,
      toCliLocaleContent(content),
    ])
  ),
});

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

export const AdminCliCampaignsApiHandlers = HttpApiBuilder.group(
  WorkspaceAdminApi,
  "campaigns",
  Effect.fn(function* (handlers) {
    const audiences = yield* CampaignAudienceService;
    const campaigns = yield* CampaignService;
    const recipients = yield* CampaignRecipientService;
    const sending = yield* CampaignSendService;
    const sendStatus = yield* CampaignSendStatusService;
    const ledger = yield* CliMutationIdempotency;

    const loadPreviewSource = Effect.fn("CampaignsApi.loadPreviewSource")(
      function* (input: AdministrationCampaignTemplatePreviewInputType) {
        if (input._tag === "Content") {
          return {
            purpose: input.purpose,
            content: yield* toLocaleContent(input.locale, input.content),
          };
        }
        const campaign = yield* campaigns.get(input.campaignId);
        const content = campaign.content[input.locale];
        if (content === undefined) {
          return yield* new CliInputInvalid({
            message: `The campaign has no ${input.locale} content.`,
          });
        }
        return { purpose: campaign.purpose, content };
      }
    );

    return handlers
      .handle("listCampaignAudiences", () =>
        audiences.list({ includeArchived: true }).pipe(
          Effect.map((rows) => rows.map(toCliAudience)),
          mapCampaignFailure
        )
      )
      .handle("getCampaignAudience", ({ params }) =>
        audiences
          .get(params.audienceId)
          .pipe(Effect.map(toCliAudience), mapCampaignFailure)
      )
      .handle(
        "createCampaignAudience",
        ({ payload: { audience, requestId } }) =>
          applyCampaignMutationOnce(
            ledger,
            {
              requestId,
              mutation: { kind: "campaign-audience-create", audience },
            },
            AdministrationCampaignAudience,
            decodeAudienceFilter(audience.filter).pipe(
              Effect.flatMap((filter) =>
                audiences.create({ title: audience.title, filter })
              ),
              Effect.map(toCliAudience)
            )
          ).pipe(mapCampaignFailure)
      )
      .handle(
        "updateCampaignAudience",
        ({ params, payload: { filter, ...changes } }) => {
          const update = { audienceId: params.audienceId, ...changes };
          return (
            filter === undefined
              ? audiences.update(update)
              : decodeAudienceFilter(filter).pipe(
                  Effect.flatMap((decoded) =>
                    audiences.update({ ...update, filter: decoded })
                  )
                )
          ).pipe(Effect.map(toCliAudience), mapCampaignFailure);
        }
      )
      .handle("archiveCampaignAudience", ({ params }) =>
        audiences
          .archive(params.audienceId)
          .pipe(Effect.map(toCliAudience), mapCampaignFailure)
      )
      .handle("unarchiveCampaignAudience", ({ params }) =>
        audiences
          .unarchive(params.audienceId)
          .pipe(Effect.map(toCliAudience), mapCampaignFailure)
      )
      .handle("deleteCampaignAudience", ({ params }) =>
        audiences
          .delete(params.audienceId)
          .pipe(Effect.as({ id: params.audienceId }), mapCampaignFailure)
      )
      .handle("listCampaignTemplates", () =>
        Effect.succeed(
          Object.values(campaignTemplates).map(
            ({ key, name, description }) => ({ key, name, description })
          )
        )
      )
      .handle(
        "previewCampaignTemplate",
        Effect.fn(function* ({ params, payload }) {
          const { purpose, content } = yield* loadPreviewSource(payload);
          const footer = yield* previewFooter(purpose);
          const { subject, html, text } = yield* renderCampaignEmail({
            templateKey: params.templateKey,
            locale: payload.locale,
            content,
            footer,
          });
          return { subject, html, text };
        }, mapCampaignFailure)
      )
      .handle("listCampaigns", () =>
        campaigns.list.pipe(
          Effect.map((rows) => rows.map(toCliCampaignSummary)),
          mapCampaignFailure
        )
      )
      .handle("getCampaign", ({ params }) =>
        campaigns
          .get(params.campaignId)
          .pipe(Effect.map(toCliCampaignDetail), mapCampaignFailure)
      )
      .handle("createCampaign", ({ payload: { campaign, requestId } }) =>
        applyCampaignMutationOnce(
          ledger,
          { requestId, mutation: { kind: "campaign-create", campaign } },
          AdministrationCampaignDetail,
          toLocalizedContent(campaign.content).pipe(
            Effect.flatMap((content) =>
              campaigns.create({
                title: campaign.title,
                purpose: campaign.purpose,
                templateKey: campaign.templateKey,
                audienceId: campaign.audienceId,
                content,
              })
            ),
            Effect.map(toCliCampaignDetail)
          )
        ).pipe(mapCampaignFailure)
      )
      .handle(
        "updateCampaign",
        ({ params, payload: { content: contentChanges, ...changes } }) => {
          const update = { campaignId: params.campaignId, ...changes };
          return (
            contentChanges === undefined
              ? campaigns.update(update)
              : campaigns.get(params.campaignId).pipe(
                  Effect.flatMap((current) =>
                    changeLocalizedContent(current.content, contentChanges)
                  ),
                  Effect.flatMap((content) =>
                    campaigns.update({ ...update, content })
                  )
                )
          ).pipe(Effect.map(toCliCampaignDetail), mapCampaignFailure);
        }
      )
      .handle("duplicateCampaign", ({ params: { campaignId }, payload }) =>
        applyCampaignMutationOnce(
          ledger,
          {
            requestId: payload.requestId,
            mutation: { kind: "campaign-duplicate", campaignId },
          },
          AdministrationCampaignDetail,
          campaigns.duplicate(campaignId).pipe(Effect.map(toCliCampaignDetail))
        ).pipe(mapCampaignFailure)
      )
      .handle("deleteCampaign", ({ params }) =>
        campaigns
          .delete(params.campaignId)
          .pipe(Effect.as({ id: params.campaignId }), mapCampaignFailure)
      )
      .handle(
        "previewCampaignRecipients",
        Effect.fn(function* ({ params }) {
          const campaign = yield* campaigns.get(params.campaignId);
          if (campaign.audienceId === null) {
            return yield* new CliMutationRejected({
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
        }, mapCampaignFailure)
      )
      .handle("testSendCampaign", ({ params, payload }) =>
        sending
          .testSend({
            campaignId: params.campaignId,
            extraRecipients: payload.recipients,
          })
          .pipe(
            Effect.map((result) => ({
              recipients: result.recipients,
              locales: result.locales,
              codeExpiresAt: result.codeExpiresAt.toString(),
            })),
            mapCampaignFailure
          )
      )
      .handle("sendCampaign", ({ params, payload }) =>
        sending
          .send({
            campaignId: params.campaignId,
            confirmationCode: payload.confirmationCode,
          })
          .pipe(mapCampaignFailure)
      )
      .handle("retryCampaign", ({ params, payload }) =>
        sending
          .retryUndelivered({
            campaignId: params.campaignId,
            includeUnconfirmed: payload.includeUnconfirmed,
          })
          .pipe(mapCampaignFailure)
      )
      .handle("getCampaignSendStatus", ({ params }) =>
        sendStatus.get({ campaignId: params.campaignId }).pipe(
          Effect.map((status) => ({
            send: Option.match(status, {
              onNone: () => null,
              onSome: (send) => ({
                sendId: send.sendId,
                createdAt: send.createdAt.toString(),
                completedAt: send.completedAt?.toString() ?? null,
                audienceId: send.audienceId,
                audienceFilter: send.audienceFilter,
                counts: send.counts,
                recipients: send.recipients.map((recipient) => ({
                  customerId: recipient.dotyposCustomerId,
                  locale: recipient.locale,
                  status: recipient.status,
                  skipReason: recipient.skipReason,
                  statusUpdatedAt: recipient.statusUpdatedAt.toString(),
                })),
              }),
            }),
          })),
          mapCampaignFailure
        )
      );
  })
);

/** The campaign services the campaign endpoints share with the admin UI. */
export const EmailCampaignsApiServicesLive = Layer.mergeAll(
  CampaignAudienceService.Live,
  CampaignService.Live,
  CampaignRecipientService.Live,
  CampaignSendService.Live,
  CampaignSendStatusService.Live
);
