import type {
  GoogleCalendarChannelId,
  GoogleCalendarEventId,
  GoogleCalendarICalUid,
  GoogleCalendarId,
  GoogleCalendarResourceId,
} from "./types";

type IsAssignable<From, To> = [From] extends [To] ? true : false;
type AssertFalse<Value extends false> = Value;

export type RawStringIsNotCalendarId = AssertFalse<
  IsAssignable<string, GoogleCalendarId>
>;
export type EventIdIsNotCalendarId = AssertFalse<
  IsAssignable<GoogleCalendarEventId, GoogleCalendarId>
>;
export type ICalUidIsNotEventId = AssertFalse<
  IsAssignable<GoogleCalendarICalUid, GoogleCalendarEventId>
>;
export type ChannelIdIsNotResourceId = AssertFalse<
  IsAssignable<GoogleCalendarChannelId, GoogleCalendarResourceId>
>;
