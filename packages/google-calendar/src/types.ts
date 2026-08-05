export type GoogleCalendarEventQuery = {
  readonly from: string;
  readonly to: string;
};

export type GoogleCalendarListEventsInput = GoogleCalendarEventQuery & {
  readonly calendarId: string;
};

export type GoogleCalendarWatchEventsInput = {
  readonly calendarId: string;
  readonly channelId: string;
  readonly webhookUrl: string;
  readonly webhookToken: string;
  readonly ttlSeconds: number;
};

export type GoogleCalendarWatchChannel = {
  readonly channelId: string;
  readonly resourceId?: string;
  readonly resourceUri?: string;
  readonly expiration?: number;
};

export type GoogleCalendarEventDateTime = {
  readonly date?: string;
  readonly dateTime?: string;
  readonly timeZone?: string;
};

export type GoogleCalendarEvent = {
  readonly id?: string;
  readonly iCalUID?: string;
  readonly htmlLink?: string;
  readonly recurringEventId?: string;
  readonly status?: string;
  readonly summary?: string;
  readonly description?: string;
  readonly start?: GoogleCalendarEventDateTime;
  readonly end?: GoogleCalendarEventDateTime;
  readonly originalStartTime?: GoogleCalendarEventDateTime;
};
