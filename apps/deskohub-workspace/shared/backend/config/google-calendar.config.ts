import { GoogleCalendarService } from "@deskohub/google-calendar";
import {
  GoogleCalendarRuntimeConfig,
  type IGoogleCalendarRuntimeConfig,
} from "@deskohub/google-calendar/config";
import { Layer } from "effect";
import { env } from "@/env";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";

export const GoogleCalendarRuntimeConfigLive = Layer.succeed(
  GoogleCalendarRuntimeConfig,
  {
    serviceAccountEmail: env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL,
    privateKey: env.GOOGLE_CALENDAR_PRIVATE_KEY,
    timeZone: workspaceSiteConstants.location.timeZone,
  } satisfies IGoogleCalendarRuntimeConfig
);

export const GoogleCalendarServiceLive = GoogleCalendarService.Live.pipe(
  Layer.provide(GoogleCalendarRuntimeConfigLive)
);
