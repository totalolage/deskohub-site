import type { GoogleCalendarId } from "@deskohub/google-calendar";
import type {
  SalesCalendarId,
  WorkspaceLimitationsCalendarId,
} from "./google-calendar.config";

type IsAssignable<From, To> = [From] extends [To] ? true : false;
type AssertTrue<Value extends true> = Value;
type AssertFalse<Value extends false> = Value;

export type SalesCalendarIdIsGoogleCalendarId = AssertTrue<
  IsAssignable<SalesCalendarId, GoogleCalendarId>
>;
export type WorkspaceLimitationsCalendarIdIsGoogleCalendarId = AssertTrue<
  IsAssignable<WorkspaceLimitationsCalendarId, GoogleCalendarId>
>;
export type SalesCalendarIdIsNotWorkspaceLimitationsCalendarId = AssertFalse<
  IsAssignable<SalesCalendarId, WorkspaceLimitationsCalendarId>
>;
export type WorkspaceLimitationsCalendarIdIsNotSalesCalendarId = AssertFalse<
  IsAssignable<WorkspaceLimitationsCalendarId, SalesCalendarId>
>;
