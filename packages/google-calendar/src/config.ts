import { Context, Effect } from "effect";
import { GoogleCalendarConfigError } from "./errors";

export type GoogleCalendarRuntimeConfigObj = {
  readonly calendarId: string;
  readonly serviceAccountEmail: string;
  readonly privateKey: string;
  readonly timeZone: string;
};

export class GoogleCalendarRuntimeConfig extends Context.Service<
  GoogleCalendarRuntimeConfig,
  GoogleCalendarRuntimeConfigObj
>()("@deskohub/google-calendar/GoogleCalendarRuntimeConfig") {}

export const validateGoogleCalendarRuntimeConfig = (
  config: GoogleCalendarRuntimeConfigObj
) => {
  for (const field of [
    "calendarId",
    "serviceAccountEmail",
    "privateKey",
    "timeZone",
  ] as const) {
    if (!config[field].trim()) {
      return Effect.fail(
        new GoogleCalendarConfigError({
          field,
          message: `Google Calendar ${field} is required`,
        })
      );
    }
  }

  return Effect.succeed(config);
};
