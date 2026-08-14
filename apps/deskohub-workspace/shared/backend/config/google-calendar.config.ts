import {
  GoogleCalendarIdSchema,
  GoogleCalendarService,
} from "@deskohub/google-calendar";
import {
  GoogleCalendarRuntimeConfig,
  type IGoogleCalendarRuntimeConfig,
} from "@deskohub/google-calendar/config";
import { Context, Layer, Schema } from "effect";
import { env } from "@/env";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";

export const workspaceLimitationsCalendarIdSchema = GoogleCalendarIdSchema.pipe(
  Schema.brand("WorkspaceLimitationsCalendarId")
).annotate({
  identifier: "WorkspaceLimitationsCalendarId",
  description:
    "Google Calendar identifier for workspace availability limitations.",
});
export type WorkspaceLimitationsCalendarId =
  typeof workspaceLimitationsCalendarIdSchema.Type;

export const salesCalendarIdSchema = GoogleCalendarIdSchema.pipe(
  Schema.brand("SalesCalendarId")
).annotate({
  identifier: "SalesCalendarId",
  description: "Google Calendar identifier for calendar-driven sales.",
});
export type SalesCalendarId = typeof salesCalendarIdSchema.Type;

const CalendarResourceConfigSchema = Schema.Struct({
  workspaceLimitationsCalendarId: workspaceLimitationsCalendarIdSchema,
  salesCalendarId: salesCalendarIdSchema,
});

export type ICalendarResourceConfig = typeof CalendarResourceConfigSchema.Type;

export class CalendarResourceConfig extends Context.Service<
  CalendarResourceConfig,
  ICalendarResourceConfig
>()("@deskohub-workspace/config/CalendarResourceConfig") {
  static Default = Layer.effect(
    this,
    Schema.decodeUnknownEffect(CalendarResourceConfigSchema)({
      workspaceLimitationsCalendarId:
        env.GOOGLE_CALENDAR_WORKSPACE_LIMITATIONS_ID,
      salesCalendarId: env.GOOGLE_CALENDAR_SALES_ID,
    })
  );
}

export const WorkspaceGoogleCalendarRuntimeConfigLayer = Layer.succeed(
  GoogleCalendarRuntimeConfig,
  {
    serviceAccountEmail: env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL,
    privateKey: env.GOOGLE_CALENDAR_PRIVATE_KEY,
    timeZone: workspaceSiteConstants.location.timeZone,
  } satisfies IGoogleCalendarRuntimeConfig
);

export const WorkspaceGoogleCalendarLayer = GoogleCalendarService.Default.pipe(
  Layer.provide(WorkspaceGoogleCalendarRuntimeConfigLayer)
);
