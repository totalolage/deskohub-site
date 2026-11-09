import {
  AdministrationCampaignId,
  type AdministrationCampaignIdType,
  AdministrationCampaignPurpose,
  type AdministrationCampaignPurposeType,
  AdministrationCampaignTemplateKey,
  type AdministrationCampaignTemplatePreviewInputType,
} from "@deskohub/workspace-admin-api";
import { Console, Effect, FileSystem, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import {
  InvalidMutationInputError,
  runAuthenticatedCommand,
} from "../command-runtime";
import { campaignLocaleFlag, readBodies, requireText } from "./campaign-input";

const templatesListCommand = Command.make("list", {}, () =>
  runAuthenticatedCommand((api, accessToken, json) =>
    Effect.gen(function* () {
      const templates = yield* api.listCampaignTemplates(accessToken);
      if (json) {
        yield* Console.log(JSON.stringify(templates));
        return;
      }
      yield* Console.log(`Campaign templates: ${templates.length}`);
      for (const template of templates) {
        yield* Console.log(
          [template.key, template.name, template.description].join("\t")
        );
      }
    })
  )
).pipe(Command.withDescription("List campaign email templates"));

const templatesPreviewCommand = Command.make(
  "preview",
  {
    templateKey: Argument.choice(
      "template-key",
      AdministrationCampaignTemplateKey.literals
    ),
    locale: campaignLocaleFlag("locale").pipe(
      Flag.withDescription("Locale to render: cs or en")
    ),
    campaign: Flag.string("campaign").pipe(
      Flag.withSchema(AdministrationCampaignId),
      Flag.optional,
      Flag.withDescription("Render a saved campaign's texts")
    ),
    purpose: Flag.choice(
      "purpose",
      AdministrationCampaignPurpose.literals
    ).pipe(Flag.optional, Flag.withDescription("Purpose of unsaved texts")),
    subject: Flag.string("subject").pipe(
      Flag.optional,
      Flag.withDescription("Subject of unsaved texts")
    ),
    preheader: Flag.string("preheader").pipe(
      Flag.optional,
      Flag.withDescription("Preheader of unsaved texts")
    ),
    body: Flag.string("body").pipe(
      Flag.optional,
      Flag.withDescription("Markdown body file of unsaved texts")
    ),
    operationalReason: Flag.string("operational-reason").pipe(
      Flag.optional,
      Flag.withDescription("Footer reason line of unsaved operational texts")
    ),
    output: Flag.string("output").pipe(
      Flag.optional,
      Flag.withDescription("Write the rendered email to this file")
    ),
    text: Flag.boolean("text").pipe(
      Flag.withDescription("Render the plain-text version instead of HTML")
    ),
  },
  (flags) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const input = yield* makePreviewInput(flags);
        const preview = yield* api.previewCampaignTemplate(
          accessToken,
          flags.templateKey,
          input
        );
        const rendered = flags.text ? preview.text : preview.html;
        if (Option.isNone(flags.output)) {
          yield* Console.log(json ? JSON.stringify(preview) : rendered);
          return;
        }
        const output = flags.output.value;
        const fileSystem = yield* FileSystem.FileSystem;
        yield* fileSystem.writeFileString(output, rendered);
        yield* Console.log(
          json
            ? JSON.stringify({ subject: preview.subject, output })
            : `Wrote the preview of "${preview.subject}" to ${output}.`
        );
      })
    )
).pipe(
  Command.withDescription(
    "Render a template with a saved campaign or with unsaved texts"
  )
);

const makePreviewInput = (flags: {
  readonly locale: AdministrationCampaignTemplatePreviewInputType["locale"];
  readonly campaign: Option.Option<AdministrationCampaignIdType>;
  readonly purpose: Option.Option<AdministrationCampaignPurposeType>;
  readonly subject: Option.Option<string>;
  readonly preheader: Option.Option<string>;
  readonly body: Option.Option<string>;
  readonly operationalReason: Option.Option<string>;
}) =>
  Effect.gen(function* () {
    const hasContentFlags = [
      flags.purpose,
      flags.subject,
      flags.preheader,
      flags.body,
      flags.operationalReason,
    ].some(Option.isSome);
    if (Option.isSome(flags.campaign)) {
      if (hasContentFlags) {
        return yield* new InvalidMutationInputError({
          message:
            "--campaign renders saved texts; drop --purpose, --subject, --preheader, --body, and --operational-reason.",
        });
      }
      return {
        _tag: "Campaign",
        campaignId: flags.campaign.value,
        locale: flags.locale,
      } satisfies AdministrationCampaignTemplatePreviewInputType;
    }
    if (
      Option.isNone(flags.purpose) ||
      Option.isNone(flags.subject) ||
      Option.isNone(flags.body)
    ) {
      return yield* new InvalidMutationInputError({
        message:
          "Pass --campaign, or pass --purpose, --subject, and --body for unsaved texts.",
      });
    }
    const operationalReason = yield* Effect.transposeOption(
      Option.map(flags.operationalReason, (value) =>
        requireText("operational-reason", value)
      )
    );
    const bodies = yield* readBodies(
      new Map([[flags.locale, flags.body.value]])
    );
    return {
      _tag: "Content",
      purpose: flags.purpose.value,
      locale: flags.locale,
      content: {
        subject: flags.subject.value,
        preheader: Option.getOrElse(flags.preheader, () => ""),
        bodyMarkdown: bodies.get(flags.locale) ?? "",
        ...(Option.isSome(operationalReason) && {
          operationalReason: operationalReason.value,
        }),
      },
    } satisfies AdministrationCampaignTemplatePreviewInputType;
  });

export const campaignTemplatesCommand = Command.make("templates").pipe(
  Command.withDescription("Inspect and preview campaign email templates"),
  Command.withSubcommands([templatesListCommand, templatesPreviewCommand])
);
