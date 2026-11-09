import "@/shared/testing/workspace-test-env";

import { expect, mock, test } from "bun:test";
import { Cause, Effect, Exit } from "effect";
import { notFound } from "next/navigation";

const getNextHeaders = mock(() => Promise.resolve(new Headers()));

mock.module("next/headers", () => ({ headers: getNextHeaders }));

const captureThrown = (throwing: () => never) => {
  try {
    throwing();
  } catch (error) {
    return error;
  }
};

test("rethrows Next navigation control flow instead of wrapping it", async () => {
  const navigation = captureThrown(notFound);
  getNextHeaders.mockImplementationOnce(() => Promise.reject(navigation));
  const { getRequestHeaders } = await import("./request-headers");

  const exit = await Effect.runPromiseExit(getRequestHeaders);

  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    expect(Cause.hasFails(exit.cause)).toBe(false);
    expect(Cause.squash(exit.cause)).toBe(navigation);
  }
});
