import { expect, test } from "bun:test";
import type { Effect } from "effect";
import {
  PostHogPersonsFailureCode,
  type PostHogPersonsOperation,
  type PostHogPersonsReadFailure,
  PostHogPersonsUnavailable,
  type PostHogPersonsUncertain,
  type PostHogPersonsWriteFailure,
  postHogPersonsFailureLogFields,
} from "./errors";
import type { IPostHogPersonsService } from "./service";

type Expect<T extends true> = T;
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;

// Every tag carries the port prefix.
export type Prefixed = Expect<
  Equal<
    PostHogPersonsWriteFailure["_tag"] extends `PostHogPersons${string}`
      ? true
      : false,
    true
  >
>;
// The operation literal is exactly the interface.
export type Operations = Expect<
  Equal<PostHogPersonsOperation, keyof IPostHogPersonsService>
>;
// Reads exclude Uncertain.
export type ReadsCertain = Expect<
  Equal<Extract<PostHogPersonsReadFailure, PostHogPersonsUncertain>, never>
>;
// The deletion is a write: its channel is exactly the write union.
export type DeletionChannel = Expect<
  Equal<
    Effect.Error<
      ReturnType<IPostHogPersonsService["deletePersonKeepingEvents"]>
    >,
    PostHogPersonsWriteFailure
  >
>;
// Every tag has a code.
export type CodesTotal = Expect<
  Equal<
    keyof typeof PostHogPersonsFailureCode,
    PostHogPersonsWriteFailure["_tag"]
  >
>;

test("each tag has its own stable failure code", () => {
  const codes = Object.values(PostHogPersonsFailureCode);
  expect(new Set(codes).size).toBe(codes.length);
});

test("log fields carry the code, reason, operation, request and status", () => {
  expect(
    postHogPersonsFailureLogFields(
      new PostHogPersonsUnavailable({
        operation: "deletePersonKeepingEvents",
        request: "persons.bulkDelete",
        reason: "rate-limited",
        httpStatus: 429,
      })
    )
  ).toEqual({
    postHogPersonsCode: "posthog-persons-unavailable",
    postHogPersonsReason: "rate-limited",
    postHogPersonsOperation: "deletePersonKeepingEvents",
    postHogPersonsRequest: "persons.bulkDelete",
    postHogPersonsHttpStatus: 429,
  });
});
