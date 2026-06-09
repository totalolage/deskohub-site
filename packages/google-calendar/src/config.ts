import { Context } from "effect";

export type GoogleCalendarRuntimeConfigObj = {
  readonly calendarId: string;
  readonly serviceAccountEmail: string;
  readonly privateKey: string;
  readonly timeZone: string;
};

export class GoogleCalendarRuntimeConfig extends Context.Tag(
  "@deskohub/google-calendar/GoogleCalendarRuntimeConfig"
)<GoogleCalendarRuntimeConfig, GoogleCalendarRuntimeConfigObj>() {}
