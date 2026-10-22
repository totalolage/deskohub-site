import {
  AdministrationCampaignAudienceId,
  type AdministrationCampaignAudienceType,
} from "@deskohub/workspace-admin-api";
import { Console, Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import {
  confirmationFlag,
  confirmChange,
  InvalidMutationInputError,
  makeMutationRequestId,
  reportCancellation,
  runAuthenticatedCommand,
} from "../command-runtime";
import { readAudienceFilter, requireText } from "./campaign-input";

const audienceIdArgument = Argument.string("audience-id").pipe(
  Argument.withSchema(AdministrationCampaignAudienceId)
);

const filterFlags = {
  filterFile: Flag.string("filter-file").pipe(
    Flag.optional,
    Flag.withDescription(
      'JSON file with the audience filter tree: AND/OR groups of attribute conditions, e.g. {"_tag":"Group","operator":"and","filters":[{"attribute":"campaignEmailCount","_tag":"Condition","params":{"purpose":"marketing","period":{"_tag":"Last","count":10,"unit":"day"}},"operator":"eq","value":0}]}. To count emails of one campaign, set "purpose":"any" and "campaign":{"_tag":"Specific","campaignId":"<id>"}; {"_tag":"Past"} is any time so far.'
    )
  ),
  filter: Flag.string("filter").pipe(
    Flag.optional,
    Flag.withDescription("Audience filter tree as inline JSON")
  ),
};

const formatAudienceState = (audience: AdministrationCampaignAudienceType) =>
  audience.archivedAt === null ? "Active" : `Archived ${audience.archivedAt}`;

const formatAudienceRow = (audience: AdministrationCampaignAudienceType) =>
  [
    audience.id,
    audience.title,
    formatAudienceState(audience),
    audience.updatedAt,
  ].join("\t");

const audiencesListCommand = Command.make(
  "list",
  {
    archived: Flag.boolean("archived").pipe(
      Flag.withDescription("Include archived audiences")
    ),
  },
  ({ archived }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const audiences = (yield* api.listCampaignAudiences(
          accessToken
        )).filter((audience) => archived || audience.archivedAt === null);
        if (json) {
          yield* Console.log(JSON.stringify(audiences));
          return;
        }
        yield* Console.log(`Campaign audiences: ${audiences.length}`);
        for (const audience of audiences) {
          yield* Console.log(formatAudienceRow(audience));
        }
      })
    )
).pipe(Command.withDescription("List saved campaign audiences"));

const audiencesShowCommand = Command.make(
  "show",
  { audienceId: audienceIdArgument },
  ({ audienceId }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const audience = yield* api.getCampaignAudience(
          accessToken,
          audienceId
        );
        if (json) {
          yield* Console.log(JSON.stringify(audience));
          return;
        }
        yield* Console.log(formatAudienceRow(audience));
        yield* Console.log(
          `Filter\n${JSON.stringify(audience.filter, null, 2)}`
        );
      })
    )
).pipe(Command.withDescription("Show a campaign audience and its filter"));

const reportAudience = (
  json: boolean,
  verb: string,
  audience: AdministrationCampaignAudienceType
) =>
  Console.log(
    json
      ? JSON.stringify(audience)
      : `${verb} audience ${audience.title} (${audience.id}).`
  );

const audiencesCreateCommand = Command.make(
  "create",
  {
    title: Flag.string("title").pipe(Flag.withDescription("Audience title")),
    ...filterFlags,
  },
  ({ filter, filterFile, title }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const audienceTitle = yield* requireText("title", title);
        const decodedFilter = yield* readAudienceFilter({ filter, filterFile });
        if (Option.isNone(decodedFilter)) {
          return yield* new InvalidMutationInputError({
            message: "Pass the audience filter with --filter-file or --filter.",
          });
        }
        const audience = yield* api.createCampaignAudience(
          accessToken,
          yield* makeMutationRequestId,
          { title: audienceTitle, filter: decodedFilter.value }
        );
        yield* reportAudience(json, "Created", audience);
      })
    )
).pipe(Command.withDescription("Save a new campaign audience"));

const audiencesUpdateCommand = Command.make(
  "update",
  {
    audienceId: audienceIdArgument,
    title: Flag.string("title").pipe(
      Flag.optional,
      Flag.withDescription("New audience title")
    ),
    ...filterFlags,
  },
  ({ audienceId, filter, filterFile, title }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const audienceTitle = yield* Effect.transposeOption(
          Option.map(title, (value) => requireText("title", value))
        );
        const decodedFilter = yield* readAudienceFilter({ filter, filterFile });
        if (Option.isNone(audienceTitle) && Option.isNone(decodedFilter)) {
          return yield* new InvalidMutationInputError({
            message:
              "Nothing to update. Pass --title, --filter-file, or --filter.",
          });
        }
        const audience = yield* api.updateCampaignAudience(
          accessToken,
          audienceId,
          {
            ...(Option.isSome(audienceTitle) && {
              title: audienceTitle.value,
            }),
            ...(Option.isSome(decodedFilter) && {
              filter: decodedFilter.value,
            }),
          }
        );
        yield* reportAudience(json, "Updated", audience);
      })
    )
).pipe(Command.withDescription("Change a campaign audience"));

const audiencesArchiveCommand = Command.make(
  "archive",
  { audienceId: audienceIdArgument, yes: confirmationFlag },
  ({ audienceId, yes }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const confirmed = yield* confirmChange(
          "campaigns.archiveCampaignAudience",
          yes,
          json,
          `Archive campaign audience ${audienceId}? It can no longer be picked for campaigns.`
        );
        if (!confirmed) {
          yield* reportCancellation(json);
          return;
        }
        const audience = yield* api.archiveCampaignAudience(
          accessToken,
          audienceId
        );
        yield* reportAudience(json, "Archived", audience);
      })
    )
).pipe(Command.withDescription("Archive a campaign audience"));

const audiencesUnarchiveCommand = Command.make(
  "unarchive",
  { audienceId: audienceIdArgument },
  ({ audienceId }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const audience = yield* api.unarchiveCampaignAudience(
          accessToken,
          audienceId
        );
        yield* reportAudience(json, "Unarchived", audience);
      })
    )
).pipe(
  Command.withDescription("Make an archived campaign audience selectable again")
);

const audiencesDeleteCommand = Command.make(
  "delete",
  { audienceId: audienceIdArgument, yes: confirmationFlag },
  ({ audienceId, yes }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const confirmed = yield* confirmChange(
          "campaigns.deleteCampaignAudience",
          yes,
          json,
          `Delete campaign audience ${audienceId}? This cannot be undone.`
        );
        if (!confirmed) {
          yield* reportCancellation(json);
          return;
        }
        const result = yield* api.deleteCampaignAudience(
          accessToken,
          audienceId
        );
        yield* Console.log(
          json ? JSON.stringify(result) : `Deleted audience ${result.id}.`
        );
      })
    )
).pipe(Command.withDescription("Delete a campaign audience no campaign uses"));

export const campaignAudiencesCommand = Command.make("audiences").pipe(
  Command.withDescription("Manage saved campaign audiences"),
  Command.withSubcommands([
    audiencesListCommand,
    audiencesShowCommand,
    audiencesCreateCommand,
    audiencesUpdateCommand,
    audiencesArchiveCommand,
    audiencesUnarchiveCommand,
    audiencesDeleteCommand,
  ])
);
