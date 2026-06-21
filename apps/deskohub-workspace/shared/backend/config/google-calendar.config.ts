import { GoogleCalendarService } from "@deskohub/google-calendar";
import {
  GoogleCalendarRuntimeConfig,
  type GoogleCalendarRuntimeConfigObj,
} from "@deskohub/google-calendar/config";
import { Layer } from "effect";
import { env } from "@/env";

export const GoogleCalendarRuntimeConfigLive = Layer.succeed(
  GoogleCalendarRuntimeConfig,
  {
    calendarId: env.GOOGLE_CALENDAR_ID,
    serviceAccountEmail: env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL,
    privateKey: env.GOOGLE_CALENDAR_PRIVATE_KEY,
    timeZone: "Europe/Prague",
  } satisfies GoogleCalendarRuntimeConfigObj
);

export const GoogleCalendarServiceLive = GoogleCalendarService.Live.pipe(
  Layer.provide(GoogleCalendarRuntimeConfigLive)
);
