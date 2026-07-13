import { Context, Effect } from "effect";
import { GoogleCalendarConfigError } from "./errors";

export interface IGoogleCalendarRuntimeConfig {
  readonly serviceAccountEmail: string;
  readonly privateKey: string;
  readonly timeZone: string;
}

export class GoogleCalendarRuntimeConfig extends Context.Service<
  GoogleCalendarRuntimeConfig,
  IGoogleCalendarRuntimeConfig
>()("@deskohub/google-calendar/GoogleCalendarRuntimeConfig") {}

export const validateGoogleCalendarRuntimeConfig = (
  config: IGoogleCalendarRuntimeConfig
) => {
  for (const field of [
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
