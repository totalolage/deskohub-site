import {
  AdministrationCampaignAudienceId,
  AdministrationCampaignDelivery,
  type AdministrationCampaignDetailType,
  AdministrationCampaignId,
  type AdministrationCampaignLocaleType,
  AdministrationCampaignPurpose,
  type AdministrationCampaignRecipientPreviewType,
  AdministrationCampaignRecipientStatus,
  type AdministrationCampaignSendStatusType,
  type AdministrationCampaignSummaryType,
  AdministrationCampaignTemplateKey,
  type AdministrationCampaignUpdateInputType,
} from "@deskohub/workspace-admin-api";
import { Console, Effect, FileSystem, Option, Path } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import {
  confirmationFlag,
  confirmChange,
  InvalidMutationInputError,
  makeMutationRequestId,
  reportCancellation,
  runAuthenticatedCommand,
} from "../command-runtime";
import { campaignAudiencesCommand } from "./campaign-audiences.command";
import {
  campaignBodyFileName,
  campaignLocaleFlag,
  localizedFlag,
  makeCampaignContent,
  makeCampaignContentPatch,
  requireText,
} from "./campaign-input";
import { campaignTemplatesCommand } from "./campaign-templates.command";

const campaignIdArgument = Argument.string("campaign-id").pipe(
  Argument.withSchema(AdministrationCampaignId)
);

const localizedContentFlags = {
  subject: localizedFlag("subject", "Email subject"),
  preheader: localizedFlag("preheader", "Inbox preview text"),
  body: localizedFlag("body", "Markdown body file"),
  operationalReason: localizedFlag(
    "operational-reason",
    "Footer reason line of an operational campaign"
  ),
};

const formatCampaignRow = (campaign: AdministrationCampaignSummaryType) =>
  [
    campaign.id,
    campaign.title,
    campaign.purpose,
    campaign.status,
    campaign.locales.join(",") || "No locales",
    campaign.audienceId ?? "No audience",
    campaign.updatedAt,
  ].join("\t");

const reportCampaign = (
  json: boolean,
  verb: string,
  campaign: AdministrationCampaignDetailType
) =>
  Console.log(
    json
      ? JSON.stringify(campaign)
      : `${verb} campaign ${campaign.title} (${campaign.id}).`
  );

const campaignsListCommand = Command.make("list", {}, () =>
  runAuthenticatedCommand((api, accessToken, json) =>
    Effect.gen(function* () {
      const campaigns = yield* api.listCampaigns(accessToken);
      if (json) {
        yield* Console.log(JSON.stringify(campaigns));
        return;
      }
      yield* Console.log(`Campaigns: ${campaigns.length}`);
      for (const campaign of campaigns) {
        yield* Console.log(formatCampaignRow(campaign));
      }
    })
  )
).pipe(Command.withDescription("List email campaigns"));

const campaignsShowCommand = Command.make(
  "show",
  {
    campaignId: campaignIdArgument,
    exportDir: Flag.string("export-dir").pipe(
      Flag.optional,
      Flag.withDescription(
        "Write each locale's Markdown body to cs.md or en.md in this directory"
      )
    ),
  },
  ({ campaignId, exportDir }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const campaign = yield* api.getCampaign(accessToken, campaignId);
        const exportedFiles = yield* Option.match(exportDir, {
          onNone: () => Effect.succeed(Option.none<ExportedBodies>()),
          onSome: (directory) =>
            exportBodies(campaign, directory).pipe(Effect.map(Option.some)),
        });
        if (json) {
          yield* Console.log(
            JSON.stringify(
              Option.match(exportedFiles, {
                onNone: () => campaign,
                onSome: (files) => ({
                  ...campaign,
                  exportedFiles: Object.fromEntries(files),
                }),
              })
            )
          );
          return;
        }
        yield* Console.log(formatCampaignDetail(campaign, exportedFiles));
      })
    )
).pipe(
  Command.withDescription("Show a campaign and export its Markdown bodies")
);

type ExportedBodies = ReadonlyMap<AdministrationCampaignLocaleType, string>;

const campaignContentEntries = (campaign: AdministrationCampaignDetailType) =>
  campaign.locales.flatMap((locale) => {
    const content = campaign.content[locale];
    return content === undefined ? [] : [[locale, content] as const];
  });

const exportBodies = (
  campaign: AdministrationCampaignDetailType,
  directory: string
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fileSystem.makeDirectory(directory, { recursive: true });
    const files = new Map<AdministrationCampaignLocaleType, string>();
    for (const [locale, content] of campaignContentEntries(campaign)) {
      const file = path.join(directory, campaignBodyFileName(locale));
      yield* fileSystem.writeFileString(file, content.bodyMarkdown);
      files.set(locale, file);
    }
    return files as ExportedBodies;
  });

const formatCampaignDetail = (
  campaign: AdministrationCampaignDetailType,
  exportedFiles: Option.Option<ExportedBodies>
) =>
  [
    [campaign.id, campaign.title].join("\t"),
    `Purpose\t${campaign.purpose}`,
    `Template\t${campaign.templateKey}`,
    `Status\t${campaign.status}`,
    `Audience\t${campaign.audienceId ?? "None"}`,
    `Updated\t${campaign.updatedAt}`,
    ...campaignContentEntries(campaign).flatMap(([locale, content]) => [
      "",
      `[${locale}]`,
      `Subject\t${content.subject}`,
      `Preheader\t${content.preheader}`,
      ...(content.operationalReason === undefined
        ? []
        : [`Operational reason\t${content.operationalReason}`]),
      ...Option.match(exportedFiles, {
        onNone: () => ["", content.bodyMarkdown],
        onSome: (files) => [`Body\t${files.get(locale) ?? "Not exported"}`],
      }),
    ]),
  ].join("\n");

const campaignsCreateCommand = Command.make(
  "create",
  {
    title: Flag.string("title").pipe(Flag.withDescription("Campaign title")),
    purpose: Flag.choice(
      "purpose",
      AdministrationCampaignPurpose.literals
    ).pipe(
      Flag.withDescription(
        "marketing needs consent; operational goes to every recipient"
      )
    ),
    template: Flag.choice(
      "template",
      AdministrationCampaignTemplateKey.literals
    ).pipe(
      Flag.withDefault("workspace" as const),
      Flag.withDescription("Email template")
    ),
    audience: Flag.string("audience").pipe(
      Flag.withSchema(AdministrationCampaignAudienceId),
      Flag.optional,
      Flag.withDescription("Saved audience ID")
    ),
    delivery: Flag.choice(
      "delivery",
      AdministrationCampaignDelivery.literals
    ).pipe(
      Flag.optional,
      Flag.withDescription(
        "once sends it once; automated sends it from an automation flow. Default: once"
      )
    ),
    ...localizedContentFlags,
    subject: localizedFlag("subject", "Email subject", 1),
    body: localizedFlag("body", "Markdown body file", 1),
  },
  ({ audience, delivery, template, title, purpose, ...content }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const campaignTitle = yield* requireText("title", title);
        const campaignContent = yield* makeCampaignContent(content);
        const campaign = yield* api.createCampaign(
          accessToken,
          yield* makeMutationRequestId,
          {
            title: campaignTitle,
            purpose,
            templateKey: template,
            ...(Option.isSome(delivery) && { delivery: delivery.value }),
            audienceId: Option.getOrNull(audience),
            content: campaignContent,
          }
        );
        yield* reportCampaign(json, "Created", campaign);
      })
    )
).pipe(Command.withDescription("Create a draft campaign"));

const campaignsUpdateCommand = Command.make(
  "update",
  {
    campaignId: campaignIdArgument,
    title: Flag.string("title").pipe(
      Flag.optional,
      Flag.withDescription("New campaign title")
    ),
    purpose: Flag.choice(
      "purpose",
      AdministrationCampaignPurpose.literals
    ).pipe(Flag.optional, Flag.withDescription("New purpose")),
    template: Flag.choice(
      "template",
      AdministrationCampaignTemplateKey.literals
    ).pipe(Flag.optional, Flag.withDescription("New email template")),
    audience: Flag.string("audience").pipe(
      Flag.withSchema(AdministrationCampaignAudienceId),
      Flag.optional,
      Flag.withDescription("New saved audience ID")
    ),
    clearAudience: Flag.boolean("clear-audience").pipe(
      Flag.withDescription("Unassign the audience")
    ),
    ...localizedContentFlags,
    clearOperationalReason: campaignLocaleFlag("clear-operational-reason").pipe(
      Flag.atLeast(0),
      Flag.withDescription(
        "Restore the default footer reason line of a locale: cs or en"
      )
    ),
    removeLocale: campaignLocaleFlag("remove-locale").pipe(
      Flag.atLeast(0),
      Flag.withDescription("Remove a locale's content: cs or en")
    ),
  },
  ({
    audience,
    campaignId,
    clearAudience,
    purpose,
    template,
    title,
    ...content
  }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        if (clearAudience && Option.isSome(audience)) {
          return yield* new InvalidMutationInputError({
            message: "Pass either --audience or --clear-audience, not both.",
          });
        }
        const campaignTitle = yield* Effect.transposeOption(
          Option.map(title, (value) => requireText("title", value))
        );
        const contentPatch = yield* makeCampaignContentPatch(content);
        const update: AdministrationCampaignUpdateInputType = {
          ...(Option.isSome(campaignTitle) && { title: campaignTitle.value }),
          ...(Option.isSome(purpose) && { purpose: purpose.value }),
          ...(Option.isSome(template) && { templateKey: template.value }),
          ...(Option.isSome(audience) && { audienceId: audience.value }),
          ...(clearAudience && { audienceId: null }),
          ...(Option.isSome(contentPatch) && { content: contentPatch.value }),
        };
        if (Object.keys(update).length === 0) {
          return yield* new InvalidMutationInputError({
            message:
              "Nothing to update. Pass at least one change, such as --title or --subject.",
          });
        }
        const campaign = yield* api.updateCampaign(
          accessToken,
          campaignId,
          update
        );
        yield* reportCampaign(json, "Updated", campaign);
      })
    )
).pipe(Command.withDescription("Change a draft campaign"));

const campaignsDuplicateCommand = Command.make(
  "duplicate",
  { campaignId: campaignIdArgument },
  ({ campaignId }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const campaign = yield* api.duplicateCampaign(
          accessToken,
          yield* makeMutationRequestId,
          campaignId
        );
        yield* reportCampaign(json, "Created draft", campaign);
      })
    )
).pipe(Command.withDescription("Copy a campaign into a new draft"));

const campaignsDeleteCommand = Command.make(
  "delete",
  { campaignId: campaignIdArgument, yes: confirmationFlag },
  ({ campaignId, yes }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const confirmed = yield* confirmChange(
          "campaigns.deleteCampaign",
          yes,
          json,
          `Delete campaign ${campaignId}? This cannot be undone.`
        );
        if (!confirmed) {
          yield* reportCancellation(json);
          return;
        }
        const result = yield* api.deleteCampaign(accessToken, campaignId);
        yield* Console.log(
          json ? JSON.stringify(result) : `Deleted campaign ${result.id}.`
        );
      })
    )
).pipe(Command.withDescription("Delete a draft campaign"));

const campaignsRecipientsCommand = Command.make(
  "recipients",
  { campaignId: campaignIdArgument },
  ({ campaignId }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const preview = yield* api.previewCampaignRecipients(
          accessToken,
          campaignId
        );
        yield* Console.log(
          json ? JSON.stringify(preview) : formatRecipientPreview(preview)
        );
      })
    )
).pipe(
  Command.withDescription("Preview who the campaign's audience reaches now")
);

const formatRecipientPreview = (
  preview: AdministrationCampaignRecipientPreviewType
) =>
  [
    `Recipients: ${preview.recipients.length}`,
    ...preview.recipients.map((recipient) =>
      [recipient.customerId, recipient.locale, recipient.email].join("\t")
    ),
    `Exclusions: ${preview.exclusions.length}`,
    ...preview.exclusions.map((exclusion) =>
      [exclusion.customerId, exclusion.reason].join("\t")
    ),
    `Shared emails: ${preview.duplicates.length}`,
    ...preview.duplicates.map((duplicate) =>
      [
        duplicate.email,
        `mails ${duplicate.recipientCustomerId}`,
        `skips ${duplicate.duplicateCustomerIds.join(",")}`,
      ].join("\t")
    ),
  ].join("\n");

const campaignsSettingsCommand = Command.make("settings", {}, () =>
  runAuthenticatedCommand((api, accessToken, json) =>
    Effect.gen(function* () {
      const settings = yield* api.getCampaignSettings(accessToken);
      yield* Console.log(
        json
          ? JSON.stringify(settings)
          : `Test-send inbox: ${settings.testSendInbox ?? "not configured"}`
      );
    })
  )
).pipe(
  Command.withDescription("Show the inbox every campaign test send reaches")
);

const campaignsTestSendCommand = Command.make(
  "test-send",
  {
    campaignId: campaignIdArgument,
    to: Flag.string("to").pipe(
      Flag.atLeast(0),
      Flag.withDescription(
        "Extra test recipient email; the admin inbox always gets one; repeat for more"
      )
    ),
  },
  ({ campaignId, to }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const recipients = yield* Effect.forEach(to, (recipient) =>
          requireText("to", recipient)
        );
        const result = yield* api.testSendCampaign(accessToken, campaignId, {
          recipients,
        });
        if (json) {
          yield* Console.log(JSON.stringify(result));
          return;
        }
        yield* Console.log(
          [
            `Sent test emails in ${result.locales.join(", ")} to ${result.recipients.join(", ")}.`,
            `Their confirmation code expires at ${result.codeExpiresAt}.`,
            `Send the campaign with: dhw campaigns send ${campaignId} --code <code>`,
          ].join("\n")
        );
      })
    )
).pipe(
  Command.withDescription(
    "Email a test copy per locale with the code that confirms the real send"
  )
);

const campaignsSendCommand = Command.make(
  "send",
  {
    campaignId: campaignIdArgument,
    code: Flag.string("code").pipe(
      Flag.withDescription("Confirmation code from the latest test email")
    ),
    yes: confirmationFlag,
  },
  ({ campaignId, code, yes }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const confirmationCode = yield* requireText("code", code);
        if (!yes) {
          const campaign = yield* api.getCampaign(accessToken, campaignId);
          const confirmed = yield* confirmChange(
            "campaigns.sendCampaign",
            yes,
            json,
            `Send campaign "${campaign.title}" (${campaign.id}) to its audience now? This cannot be undone.`
          );
          if (!confirmed) {
            yield* reportCancellation(json);
            return;
          }
        }
        const result = yield* api.sendCampaign(accessToken, campaignId, {
          confirmationCode,
        });
        yield* Console.log(
          json
            ? JSON.stringify(result)
            : [
                `Sending campaign ${campaignId} to ${result.recipientCount} recipients (send ${result.sendId}).`,
                `Follow progress with: dhw campaigns status ${campaignId}`,
              ].join("\n")
        );
      })
    )
).pipe(Command.withDescription("Send a campaign to its audience"));

const campaignsRetryCommand = Command.make(
  "retry",
  {
    campaignId: campaignIdArgument,
    includeUnconfirmed: Flag.boolean("include-unconfirmed").pipe(
      Flag.withDescription(
        "Also mail unconfirmed recipients, who may already have the email"
      )
    ),
    yes: confirmationFlag,
  },
  ({ campaignId, includeUnconfirmed, yes }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const confirmed = yield* confirmChange(
          "campaigns.retryCampaign",
          yes,
          json,
          includeUnconfirmed
            ? `Retry the undelivered recipients of campaign ${campaignId}, including unconfirmed ones who may already have the email?`
            : `Retry the pending and failed recipients of campaign ${campaignId}?`
        );
        if (!confirmed) {
          yield* reportCancellation(json);
          return;
        }
        const result = yield* api.retryCampaign(accessToken, campaignId, {
          includeUnconfirmed,
        });
        yield* Console.log(
          json
            ? JSON.stringify(result)
            : `Retrying ${result.retriedCount} recipients (send ${result.sendId}).`
        );
      })
    )
).pipe(
  Command.withDescription(
    "Retry a failed campaign's pending and failed recipients"
  )
);

const campaignsStatusCommand = Command.make(
  "status",
  { campaignId: campaignIdArgument },
  ({ campaignId }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const status = yield* api.getCampaignSendStatus(
          accessToken,
          campaignId
        );
        if (json) {
          yield* Console.log(JSON.stringify(status));
          return;
        }
        yield* Console.log(
          status.send === null
            ? `Campaign ${campaignId} has not been sent yet.`
            : formatSendStatus(status.send)
        );
      })
    )
).pipe(Command.withDescription("Show a campaign's delivery status"));

const formatSendStatus = (send: AdministrationCampaignSendStatusType) =>
  [
    [
      `Send ${send.sendId}`,
      `started ${send.createdAt}`,
      send.completedAt === null
        ? "in progress"
        : `completed ${send.completedAt}`,
    ].join("\t"),
    `Audience\t${send.audienceId ?? "None"}`,
    ...AdministrationCampaignRecipientStatus.literals.map(
      (status) => `${status}\t${send.counts[status]}`
    ),
    `Recipients: ${send.recipients.length}`,
    ...send.recipients.map((recipient) =>
      [
        recipient.customerId,
        recipient.locale,
        recipient.skipReason === null
          ? recipient.status
          : `${recipient.status} (${recipient.skipReason})`,
        recipient.statusUpdatedAt,
      ].join("\t")
    ),
  ].join("\n");

export const campaignsCommand = Command.make("campaigns").pipe(
  Command.withDescription("Manage and send email campaigns"),
  Command.withSubcommands([
    campaignsListCommand,
    campaignsShowCommand,
    campaignsCreateCommand,
    campaignsUpdateCommand,
    campaignsDuplicateCommand,
    campaignsDeleteCommand,
    campaignsRecipientsCommand,
    campaignsSettingsCommand,
    campaignsTestSendCommand,
    campaignsSendCommand,
    campaignsRetryCommand,
    campaignsStatusCommand,
    campaignAudiencesCommand,
    campaignTemplatesCommand,
  ])
);
