import { GoogleCalendarService } from "@deskohub/google-calendar";
import {
  GoogleCalendarRuntimeConfig,
  type IGoogleCalendarRuntimeConfig,
} from "@deskohub/google-calendar/config";
import { Layer } from "effect";
import { env } from "@/env";
import { siteConstants } from "@/shared/utils/constants";

const boardgameGoogleCalendarConfigLayer = Layer.succeed(
  GoogleCalendarRuntimeConfig,
  {
    serviceAccountEmail: env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL,
    privateKey: env.GOOGLE_CALENDAR_PRIVATE_KEY,
    timeZone: siteConstants.workingHours.timezone,
  } satisfies IGoogleCalendarRuntimeConfig
);

export const BoardgameGoogleCalendarLayer = GoogleCalendarService.Live.pipe(
  Layer.provide(boardgameGoogleCalendarConfigLayer)
);
