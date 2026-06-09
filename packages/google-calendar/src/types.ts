export type GoogleCalendarEventQuery = {
  readonly from: string;
  readonly to: string;
};

export type GoogleCalendarEventDateTime = {
  readonly date?: string;
  readonly dateTime?: string;
  readonly timeZone?: string;
};

export type GoogleCalendarEvent = {
  readonly id?: string;
  readonly iCalUID?: string;
  readonly status?: string;
  readonly summary?: string;
  readonly description?: string;
  readonly start?: GoogleCalendarEventDateTime;
  readonly end?: GoogleCalendarEventDateTime;
};
