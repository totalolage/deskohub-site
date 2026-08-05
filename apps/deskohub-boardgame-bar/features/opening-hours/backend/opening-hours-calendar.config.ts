import { Context, Layer } from "effect";
import { env } from "@/env";

export interface IOpeningHoursCalendarConfig {
  readonly calendarId: string;
}

export class OpeningHoursCalendarConfig extends Context.Service<
  OpeningHoursCalendarConfig,
  IOpeningHoursCalendarConfig
>()("@deskohub-boardgame-bar/opening-hours/OpeningHoursCalendarConfig") {
  static Live = Layer.succeed(this, {
    calendarId: env.GOOGLE_CALENDAR_OPENING_HOURS_ID,
  });
}
