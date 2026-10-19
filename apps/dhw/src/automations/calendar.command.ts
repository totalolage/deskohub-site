import {
  CalendarExpression,
  type CalendarPreviewType,
} from "@deskohub/workspace-admin-api";
import { Console, Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { campaignLocaleFlag } from "../campaigns/campaign-input";
import { runAuthenticatedCommand } from "../command-runtime";
import { decodeJsonInput } from "../json-input";

const formatCalendarPreview = (preview: CalendarPreviewType) =>
  [
    preview.description,
    `Next starts: ${preview.nextStarts.length}`,
    ...preview.nextStarts,
    `Fires up to ${preview.frequency.maxFiresPerHour} times an hour`,
  ].join("\n");

const calendarDescribeCommand = Command.make(
  "describe",
  {
    expression: Flag.string("expression").pipe(
      Flag.withDescription(
        'Calendar expression JSON, such as {"weekdays":["monday"],"hours":[9]}'
      )
    ),
    wait: Flag.boolean("wait").pipe(
      Flag.withDescription(
        "Describe it as a wait step's condition instead of a schedule trigger"
      )
    ),
    locale: campaignLocaleFlag("locale").pipe(
      Flag.withDefault("en-US" as const),
      Flag.withDescription("Language of the description: cs or en")
    ),
  },
  ({ expression, locale, wait }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const calendar = yield* decodeJsonInput(
          CalendarExpression,
          "calendar expression",
          expression
        );
        const preview = yield* api.previewCalendarExpression(accessToken, {
          expression: calendar,
          usage: wait ? "wait" : "trigger",
          locale,
        });
        yield* Console.log(
          json ? JSON.stringify(preview) : formatCalendarPreview(preview)
        );
      })
    )
).pipe(
  Command.withDescription(
    "Describe a Prague-time calendar expression and list its next starts"
  )
);

export const calendarCommand = Command.make("calendar").pipe(
  Command.withDescription("Check calendar expressions for automations"),
  Command.withSubcommands([calendarDescribeCommand])
);
