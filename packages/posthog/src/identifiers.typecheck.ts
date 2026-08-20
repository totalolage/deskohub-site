import type {
  PostHogDistinctId,
  PostHogEventId,
  PostHogProjectId,
  PostHogSessionId,
} from "./identifiers";

type IsAssignable<From, To> = [From] extends [To] ? true : false;
type AssertFalse<Value extends false> = Value;

export type RawStringIsNotProjectId = AssertFalse<
  IsAssignable<string, PostHogProjectId>
>;
export type RawStringIsNotDistinctId = AssertFalse<
  IsAssignable<string, PostHogDistinctId>
>;
export type RawStringIsNotSessionId = AssertFalse<
  IsAssignable<string, PostHogSessionId>
>;
export type RawStringIsNotEventId = AssertFalse<
  IsAssignable<string, PostHogEventId>
>;
export type DistinctIdIsNotProjectId = AssertFalse<
  IsAssignable<PostHogDistinctId, PostHogProjectId>
>;
export type SessionIdIsNotDistinctId = AssertFalse<
  IsAssignable<PostHogSessionId, PostHogDistinctId>
>;
export type EventIdIsNotSessionId = AssertFalse<
  IsAssignable<PostHogEventId, PostHogSessionId>
>;
