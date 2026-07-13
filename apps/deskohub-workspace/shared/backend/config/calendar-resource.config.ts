import { Context, Layer } from "effect";
import { env } from "@/env";

export interface ICalendarResourceConfig {
  readonly workspaceLimitationsCalendarId: string;
  readonly salesCalendarId: string;
}

export class CalendarResourceConfig extends Context.Service<
  CalendarResourceConfig,
  ICalendarResourceConfig
>()("@deskohub-workspace/config/CalendarResourceConfig") {
  static Live = Layer.succeed(this, {
    workspaceLimitationsCalendarId:
      env.GOOGLE_CALENDAR_WORKSPACE_LIMITATIONS_ID,
    salesCalendarId: env.GOOGLE_CALENDAR_SALES_ID,
  });
}
