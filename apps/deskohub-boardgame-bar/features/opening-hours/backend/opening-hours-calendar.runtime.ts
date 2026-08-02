import { Layer } from "effect";
import { GoogleCalendarServiceLive } from "@/shared/backend/config/google-calendar.config";
import { OpeningHoursCalendarConfig } from "./opening-hours-calendar.config";
import { OpeningHoursCalendarService } from "./opening-hours-calendar.service";

export const OpeningHoursCalendarServiceLive =
  OpeningHoursCalendarService.Live.pipe(
    Layer.provide(
      Layer.mergeAll(GoogleCalendarServiceLive, OpeningHoursCalendarConfig.Live)
    )
  );
