import { Schema } from "effect";

export const GoogleCalendarIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("GoogleCalendarId")
).annotate({
  identifier: "GoogleCalendarId",
  description: "Opaque identifier of a Google Calendar calendar.",
});
export type GoogleCalendarId = typeof GoogleCalendarIdSchema.Type;

export const GoogleCalendarEventIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("GoogleCalendarEventId")
).annotate({
  identifier: "GoogleCalendarEventId",
  description: "Opaque identifier of a Google Calendar event.",
});
export type GoogleCalendarEventId = typeof GoogleCalendarEventIdSchema.Type;

export const GoogleCalendarICalUidSchema = Schema.NonEmptyString.pipe(
  Schema.brand("GoogleCalendarICalUid")
).annotate({
  identifier: "GoogleCalendarICalUid",
  description: "RFC 5545 UID associated with a Google Calendar event.",
});
export type GoogleCalendarICalUid = typeof GoogleCalendarICalUidSchema.Type;

export const GoogleCalendarChannelIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("GoogleCalendarChannelId")
).annotate({
  identifier: "GoogleCalendarChannelId",
  description: "Client-assigned identifier of a Google Calendar watch channel.",
});
export type GoogleCalendarChannelId = typeof GoogleCalendarChannelIdSchema.Type;

export const GoogleCalendarResourceIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("GoogleCalendarResourceId")
).annotate({
  identifier: "GoogleCalendarResourceId",
  description: "Google-assigned identifier of a watched calendar resource.",
});
export type GoogleCalendarResourceId =
  typeof GoogleCalendarResourceIdSchema.Type;

export type GoogleCalendarEventQuery = {
  readonly from: string;
  readonly to: string;
};

export type GoogleCalendarListEventsInput = GoogleCalendarEventQuery & {
  readonly calendarId: GoogleCalendarId;
};

export type GoogleCalendarWatchEventsInput = {
  readonly calendarId: GoogleCalendarId;
  readonly channelId: GoogleCalendarChannelId;
  readonly webhookUrl: string;
  readonly webhookToken: string;
  readonly ttlSeconds: number;
};

export type GoogleCalendarWatchChannel = {
  readonly channelId: GoogleCalendarChannelId;
  readonly resourceId?: GoogleCalendarResourceId;
  readonly resourceUri?: string;
  readonly expiration?: number;
};

export type GoogleCalendarEventDateTime = {
  readonly date?: string;
  readonly dateTime?: string;
  readonly timeZone?: string;
};

export type GoogleCalendarEvent = {
  readonly id?: GoogleCalendarEventId;
  readonly iCalUID?: GoogleCalendarICalUid;
  readonly htmlLink?: string;
  readonly recurringEventId?: GoogleCalendarEventId;
  readonly status?: string;
  readonly summary?: string;
  readonly description?: string;
  readonly start?: GoogleCalendarEventDateTime;
  readonly end?: GoogleCalendarEventDateTime;
  readonly originalStartTime?: GoogleCalendarEventDateTime;
};
